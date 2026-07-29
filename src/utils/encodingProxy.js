import { createHmac, timingSafeEqual } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { request } from 'undici';
import { config } from '../config.js';
import { cacheGet, cacheSet } from '../cache/redis.js';
import { processSubtitleBuffer } from './subtitleProcessor.js';
import { applySyncPlan } from './subtitleTiming.js';
import { deriveReferenceSyncPlan } from './referenceSync.js';
import { httpError } from './httpError.js';
import { analyzeSubtitleQuality } from './subtitleQuality.js';
import { versionRegistry } from '../services/versionRegistryService.js';
import { extractSubtitlePayload } from './subtitleArchive.js';
import { createSafeRemoteDispatcher, parsePublicRemoteUrl } from './safeRemoteUrl.js';
import { getVaultSubtitle } from '../services/vaultService.js';
import { getOpenSubtitlesDownloadLink } from '../providers/openSubtitles.js';
import { getSubsourceDownloadLink } from '../providers/subsource.js';

const MAX_TOKEN_LENGTH = 8_192;
const MAX_TOKEN_PAYLOAD_BYTES = 65_536;
const TARGET_TOKEN_LENGTH = 1_800;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const SRT_CUE_RE = /\d{2,3}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2},\d{3}/;
const YIFY_BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function unb64url(input) {
  return Buffer.from(String(input), 'base64url');
}

function signingSecret() {
  if (!config.encodingProxy.secret) throw httpError(500, 'ENCODING_PROXY_SECRET is required');
  return config.encodingProxy.secret;
}

function sign(payload) {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function assertSafeUrl(url) {
  return parsePublicRemoteUrl(url).toString();
}

function tokenText(value, maxLength = 260) {
  return String(value || '').slice(0, maxLength);
}

function compactTokenCandidate(candidate) {
  if (!candidate) return null;
  return {
    provider: tokenText(candidate.provider || 'unknown', 40),
    originalProvider: tokenText(candidate.originalProvider, 40),
    providerId: tokenText(candidate.providerId || candidate.fileId || candidate.id, 128),
    id: tokenText(candidate.id, 128),
    name: tokenText(candidate.name),
    releaseName: tokenText(candidate.releaseName),
    fileName: tokenText(candidate.fileName),
    lang: tokenText(candidate.lang || 'ara', 16),
    movieHash: tokenText(candidate.movieHash || candidate.hash, 128),
  };
}

function validVaultId(value) {
  const id = String(value || '').replace(/^vault-/, '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw httpError(400, 'Invalid vault subtitle source');
  return id;
}

function compactTokenSource(source = {}) {
  const provider = tokenText(source.provider || source.candidate?.provider || 'unknown', 40);
  if (source.kind === 'vault' || provider === 'vault' || source.candidate?.originalProvider === 'vault') {
    return {
      kind: 'vault',
      vaultId: validVaultId(source.vaultId || source.candidate?.providerId || source.candidate?.id),
      name: tokenText(source.name),
      provider: 'vault',
      candidate: compactTokenCandidate(source.candidate),
    };
  }
  if (source.kind === 'provider') {
    const providerId = tokenText(source.providerId, 128);
    const valid = provider === 'opensubtitles'
      ? /^[1-9]\d{0,19}$/.test(providerId)
      : provider === 'subsource' && /^[A-Za-z0-9_-]{1,128}$/.test(providerId);
    if (!valid) throw httpError(400, 'Invalid provider subtitle source');
    return {
      kind: 'provider',
      provider,
      providerId,
      name: tokenText(source.name),
      candidate: compactTokenCandidate(source.candidate),
    };
  }
  return {
    kind: 'remote',
    url: assertSafeUrl(source.url),
    name: tokenText(source.name),
    provider,
    candidate: compactTokenCandidate(source.candidate),
  };
}

function compactTokenFallback(fallback) {
  const source = compactTokenSource(fallback);
  return {
    ...source,
    syncPlan: fallback.syncPlan || null,
    reference: fallback.reference ? compactTokenSource(fallback.reference) : null,
  };
}

export function createEncodingToken(payload) {
  const expiresAt = Math.floor(Date.now() / 1000) + config.encodingProxy.linkTtlSeconds;
  const primarySource = compactTokenSource(payload.source || payload);
  const safePayload = {
    source: primarySource,
    options: {
      stripSdh: config.encodingProxy.stripSdhDefault,
      stripMusicNotes: config.encodingProxy.stripMusicNotes,
      ...(payload.options || {}),
    },
    syncPlan: payload.syncPlan || null,
    reference: payload.reference ? compactTokenSource(payload.reference) : null,
    candidate: primarySource.candidate,
    fallbacks: Array.isArray(payload.fallbacks)
      ? payload.fallbacks.slice(0, config.encodingProxy.maxFallbacks).map(compactTokenFallback)
      : [],
    context: payload.context ? {
      type: tokenText(payload.context.type || 'movie', 16),
      id: tokenText(payload.context.id, 128),
      videoId: tokenText(payload.context.videoId, 128),
      videoHash: tokenText(payload.context.videoHash, 128),
      videoSize: payload.context.videoSize || null,
      filename: tokenText(payload.context.filename, 320),
      title: tokenText(payload.context.title),
      imdbId: tokenText(payload.context.imdbId, 32),
      tmdbId: tokenText(payload.context.tmdbId, 32),
      season: payload.context.season || null,
      episode: payload.context.episode || null,
      durationMs: payload.context.durationMs || null,
    } : null,
    expiresAt,
  };

  function encode() {
    const raw = Buffer.from(JSON.stringify(safePayload));
    const compressed = deflateRawSync(raw, { level: 9 });
    const encoded = b64url(compressed);
    const signed = `z1.${encoded}`;
    return { token: `${signed}.${sign(signed)}`, rawBytes: raw.byteLength };
  }

  let encodedToken = encode();
  while (
    (encodedToken.token.length > TARGET_TOKEN_LENGTH || encodedToken.rawBytes > MAX_TOKEN_PAYLOAD_BYTES)
    && safePayload.fallbacks.length
  ) {
    safePayload.fallbacks.pop();
    encodedToken = encode();
  }
  if (encodedToken.rawBytes > MAX_TOKEN_PAYLOAD_BYTES || encodedToken.token.length > MAX_TOKEN_LENGTH) {
    throw httpError(413, 'Subtitle token payload is too large');
  }
  return encodedToken.token;
}

export function verifyEncodingToken(token) {
  const raw = String(token || '');
  if (!raw || raw.length > MAX_TOKEN_LENGTH) throw httpError(400, 'Invalid subtitle token');
  const parts = raw.split('.');
  const compressed = parts.length === 3 && parts[0] === 'z1';
  if ((!compressed && parts.length !== 2) || (compressed && parts.length !== 3)) {
    throw httpError(400, 'Invalid subtitle token');
  }
  const encoded = compressed ? parts[1] : parts[0];
  const signature = compressed ? parts[2] : parts[1];
  const signed = compressed ? `z1.${encoded}` : encoded;
  const expected = sign(signed);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw httpError(403, 'Invalid subtitle token signature');
  let payload;
  try {
    const bytes = compressed
      ? inflateRawSync(unb64url(encoded), { maxOutputLength: MAX_TOKEN_PAYLOAD_BYTES })
      : unb64url(encoded);
    if (bytes.byteLength > MAX_TOKEN_PAYLOAD_BYTES) throw new Error('payload too large');
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid subtitle token payload');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpError(400, 'Invalid subtitle token payload');
  if (payload.expiresAt && payload.expiresAt < Math.floor(Date.now() / 1000)) throw httpError(410, 'Subtitle token expired');
  payload.source = compactTokenSource(payload.source || payload);
  payload.url = payload.source.url || null;
  payload.name = payload.source.name;
  payload.provider = payload.source.provider;
  payload.candidate = payload.source.candidate || payload.candidate || null;
  if (payload.reference) payload.reference = compactTokenSource(payload.reference);
  if (payload.fallbacks !== undefined && !Array.isArray(payload.fallbacks)) throw httpError(400, 'Invalid subtitle fallback payload');
  payload.fallbacks = (payload.fallbacks || [])
    .slice(0, config.encodingProxy.maxFallbacks)
    .map(compactTokenFallback);
  return payload;
}

async function discardBody(body) {
  try {
    await body?.dump?.();
  } catch {
    body?.destroy?.();
  }
}

function destroyBody(body) {
  body?.on?.('error', () => {});
  body?.destroy?.();
}

export function buildRemoteSubtitleHeaders(url, provider = '') {
  const headers = {
    'user-agent': config.app.userAgent,
    accept: 'application/x-subrip,text/vtt,text/plain,application/zip,application/gzip,application/x-xz,*/*;q=0.8',
  };
  if (provider !== 'yify') return headers;
  try {
    const target = new URL(url);
    const trusted = new URL(config.yify.baseUrl);
    const match = target.origin === trusted.origin
      ? target.pathname.match(/^\/subtitle\/([^/]+)\.zip$/i)
      : null;
    if (!match) return headers;
    headers['user-agent'] = YIFY_BROWSER_USER_AGENT;
    headers.referer = `${trusted.origin}/subtitles/${match[1]}`;
  } catch {
    // The URL is validated before this helper is used; retain generic headers.
  }
  return headers;
}

export async function fetchRemoteSubtitleBuffer(url, {
  maxBytes = config.encodingProxy.maxBytes,
  maxRedirects = config.encodingProxy.maxRedirects,
  timeoutMs = config.providers.timeoutMs,
  signal,
  provider = '',
} = {}) {
  let currentUrl = assertSafeUrl(url);
  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const resolved = await createSafeRemoteDispatcher(currentUrl);
    let response;
    let bodyHandled = false;
    try {
      response = await request(resolved.url, {
        method: 'GET',
        headers: buildRemoteSubtitleHeaders(currentUrl, provider),
        dispatcher: resolved.dispatcher,
        maxRedirections: 0,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        signal,
      });

      if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
        await discardBody(response.body);
        bodyHandled = true;
        if (attempt >= maxRedirects) throw httpError(502, 'Too many subtitle redirects');
        const location = response.headers.location;
        if (!location) throw httpError(502, 'Redirect response missing location');
        currentUrl = assertSafeUrl(new URL(location, resolved.url).toString());
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        await discardBody(response.body);
        bodyHandled = true;
        throw httpError(502, `Subtitle upstream failed with ${response.statusCode}`);
      }

      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        destroyBody(response.body);
        bodyHandled = true;
        throw httpError(413, 'Subtitle file is too large');
      }

      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        total += bytes.length;
        if (total > maxBytes) {
          destroyBody(response.body);
          bodyHandled = true;
          throw httpError(413, 'Subtitle file is too large');
        }
        chunks.push(bytes);
      }
      bodyHandled = true;
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (error?.status || error?.name === 'AbortError') throw error;
      throw httpError(502, 'Subtitle download failed');
    } finally {
      if (response && !bodyHandled) destroyBody(response.body);
      try {
        await resolved.dispatcher.close();
      } catch {
        // The response error above is more useful than a dispatcher shutdown failure.
      }
    }
  }
  throw httpError(502, 'Too many subtitle redirects');
}

function assertValidProcessedSubtitle(text) {
  if (!SRT_CUE_RE.test(String(text || ''))) throw httpError(422, 'Subtitle payload does not contain valid timed cues');
}

function cacheKeyFor(payload) {
  const normalized = JSON.stringify({
    source: payload.source,
    fallbacks: payload.fallbacks || [],
    options: payload.options || {},
    syncPlan: payload.syncPlan || null,
    reference: payload.reference || null,
    context: payload.context || null,
  });
  return `encoding:v7:${sign(normalized)}`;
}

function analyzeProcessedSubtitle(text, context) {
  if (!config.qualityGate.enabled) return null;
  return analyzeSubtitleQuality(text, {
    expectedDurationMs: context?.durationMs || null,
    minCues: config.qualityGate.minCues,
    minArabicRatio: config.qualityGate.minArabicRatio,
    minCoverageRatio: config.qualityGate.minCoverageRatio,
  });
}

async function defaultProviderLinkResolver(source) {
  return source.provider === 'opensubtitles'
    ? getOpenSubtitlesDownloadLink(source.providerId)
    : getSubsourceDownloadLink(source.providerId);
}

async function fetchSourceBuffer(source, fetcher, providerLinkResolver) {
  if (source.kind === 'vault') {
    const item = await getVaultSubtitle(validVaultId(source.vaultId));
    if (!item) throw httpError(404, 'Vault subtitle not found');
    return Buffer.from(item.text, 'utf8');
  }
  if (source.kind === 'provider') {
    const remoteUrl = await providerLinkResolver(source);
    return fetcher(remoteUrl, { provider: source.provider });
  }
  return fetcher(source.url, { provider: source.provider });
}

async function loadProcessedSource(source, payload, fetcher, providerLinkResolver) {
  const buffer = await fetchSourceBuffer(source, fetcher, providerLinkResolver);
  const extracted = await extractSubtitlePayload(buffer, {
    maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
    maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
    sourceName: source.name,
  });
  const processed = processSubtitleBuffer(extracted.buffer, payload.options || {});
  assertValidProcessedSubtitle(processed.text);
  const quality = analyzeProcessedSubtitle(processed.text, payload.context);
  if (quality && !quality.valid) {
    const error = httpError(422, 'Subtitle payload failed quality validation');
    error.code = 'SUBTITLE_QUALITY_REJECTED';
    error.stage = 'source';
    error.quality = quality;
    throw error;
  }
  return { source, extracted, processed };
}

async function rejectMislabeledSource(payload, source, quality) {
  if (!payload.context || !source.candidate) return;
  try {
    await versionRegistry.recordDecision({
      action: 'reject',
      search: payload.context,
      candidate: { ...source.candidate, download: sourceDownloadValue(source), quality },
      note: 'Automatic rejection: downloaded content failed the Arabic language gate',
    });
  } catch (error) {
    console.warn('[quality-gate:reject]', error.message);
  }
}

function sourceDownloadValue(source) {
  if (source.kind === 'remote') return source.url;
  if (source.kind === 'vault') return `/vault/subtitles/${source.vaultId}.srt`;
  if (source.provider === 'opensubtitles') return `/downloads/opensubtitles/${source.providerId}.srt`;
  return `/downloads/subsource/${source.providerId}`;
}

async function finalizeProcessedSource(loaded, payload, fallbackIndex, fetcher, providerLinkResolver) {
  const { source, processed } = loaded;
  let syncPlan = source.syncPlan || (fallbackIndex === 0 ? (payload.syncPlan || null) : null);
  const reference = source.reference || (fallbackIndex === 0 ? payload.reference : null);
  if (reference) {
    try {
      const referenceBuffer = await fetchSourceBuffer(reference, fetcher, providerLinkResolver);
      const referenceExtracted = await extractSubtitlePayload(referenceBuffer, {
        maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
        maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
        sourceName: reference.name,
      });
      const referenceProcessed = processSubtitleBuffer(referenceExtracted.buffer, { ...payload.options, stripSdh: true });
      const referencePlan = deriveReferenceSyncPlan(processed.text, referenceProcessed.text, config.referenceSync);
      if (referencePlan.enabled) {
        syncPlan = {
          ...referencePlan,
          enabled: true,
          referenceProvider: reference.provider,
          referenceName: reference.name,
        };
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.warn('[reference-sync]', error.message);
    }
  }

  const text = applySyncPlan(processed.text, syncPlan || {});
  assertValidProcessedSubtitle(text);
  const quality = analyzeProcessedSubtitle(text, payload.context);
  if (quality && !quality.valid) {
    const error = httpError(422, 'Synchronized subtitle failed quality validation');
    error.code = 'SUBTITLE_QUALITY_REJECTED';
    error.stage = 'post-sync';
    error.quality = quality;
    throw error;
  }
  return { text, syncPlan, quality };
}

async function selectProcessedSource(payload, fetcher, providerLinkResolver) {
  const sources = [payload.source, ...(payload.fallbacks || [])];
  let lastError = null;
  for (const [fallbackIndex, source] of sources.entries()) {
    try {
      const loaded = await loadProcessedSource(source, payload, fetcher, providerLinkResolver);
      const finalized = await finalizeProcessedSource(loaded, payload, fallbackIndex, fetcher, providerLinkResolver);
      return { ...loaded, ...finalized, fallbackIndex };
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') throw error;
      if (
        error?.code === 'SUBTITLE_QUALITY_REJECTED'
        && error.stage === 'source'
        && error.quality?.reasons?.includes('low-arabic-ratio')
      ) {
        await rejectMislabeledSource(payload, source, error.quality);
      }
    }
  }
  throw lastError || httpError(502, 'No usable Arabic subtitle source');
}

export async function resolveProxiedSubtitle(token, {
  fetcher = fetchRemoteSubtitleBuffer,
  providerLinkResolver = defaultProviderLinkResolver,
} = {}) {
  const payload = verifyEncodingToken(token);
  const key = cacheKeyFor(payload);
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cache: 'hit' };

  const selected = await selectProcessedSource(payload, fetcher, providerLinkResolver);
  const { source, extracted, processed, fallbackIndex, text, syncPlan, quality } = selected;
  const result = {
    text,
    encoding: processed.encoding,
    format: processed.format,
    archive: extracted.archive,
    archiveEntry: extracted.entryName,
    sync: syncPlan?.enabled ? syncPlan : null,
    quality,
    fallbackIndex,
  };
  if (payload.context && source.candidate) {
    await versionRegistry.recordObservation({
      search: payload.context,
      candidate: {
        ...source.candidate,
        download: sourceDownloadValue(source),
        quality,
      },
      quality,
      sync: result.sync,
    });
  }
  await cacheSet(key, result, config.cache.subtitleTtlSeconds || config.encodingProxy.cacheTtlSeconds, config.cache.staleSeconds);
  return { ...result, cache: 'miss' };
}

function absoluteDownloadUrl(baseUrl, item) {
  const download = item.download || item.url;
  if (!download) return null;
  return download.startsWith('/') ? `${baseUrl}${download}` : download;
}

function tokenSourceForItem(baseUrl, item) {
  const provider = item.originalProvider || item.provider || 'unknown';
  if (provider === 'vault' || item.provider === 'vault') {
    return {
      kind: 'vault',
      vaultId: validVaultId(item.providerId || item.id),
      provider: 'vault',
      name: item.name || item.releaseName,
      candidate: item,
    };
  }
  const absolute = absoluteDownloadUrl(baseUrl, item);
  try {
    const target = new URL(absolute);
    const addon = new URL(baseUrl);
    const openSubtitles = target.origin === addon.origin
      ? target.pathname.match(/^\/downloads\/opensubtitles\/([1-9]\d{0,19})\.srt$/)
      : null;
    const subsource = target.origin === addon.origin
      ? target.pathname.match(/^\/downloads\/subsource\/([A-Za-z0-9_-]{1,128})$/)
      : null;
    if (openSubtitles || subsource) {
      return {
        kind: 'provider',
        provider: openSubtitles ? 'opensubtitles' : 'subsource',
        providerId: openSubtitles?.[1] || subsource?.[1],
        name: item.name || item.releaseName,
        candidate: item,
      };
    }
  } catch {
    // The normal remote-source validation below reports malformed URLs.
  }
  return {
    kind: 'remote',
    url: absolute,
    provider,
    name: item.name || item.releaseName,
    candidate: item,
  };
}

function tokenReferenceFor(baseUrl, reference) {
  if (!reference) return null;
  const source = tokenSourceForItem(baseUrl, {
    provider: reference.provider,
    originalProvider: reference.originalProvider,
    providerId: reference.providerId,
    id: reference.id,
    name: reference.name,
    download: reference.url || reference.download,
  });
  return { ...source, candidate: null };
}

export function proxiedSubtitleUrl(baseUrl, item, syncPlan = null, reference = null, context = null, fallbackItems = []) {
  const absolute = absoluteDownloadUrl(baseUrl, item);
  if (!config.encodingProxy.enabled || !absolute) return absolute;
  const fallbacks = fallbackItems
    .map(fallback => {
      const url = absoluteDownloadUrl(baseUrl, fallback);
      return url ? {
        ...tokenSourceForItem(baseUrl, fallback),
        syncPlan: fallback.syncPlan || null,
        reference: tokenReferenceFor(baseUrl, fallback.reference),
      } : null;
    })
    .filter(Boolean)
    .slice(0, config.encodingProxy.maxFallbacks);
  const token = createEncodingToken({
    source: tokenSourceForItem(baseUrl, item),
    syncPlan,
    reference: tokenReferenceFor(baseUrl, reference),
    candidate: item,
    context,
    fallbacks,
  });
  return `${baseUrl}/proxy/encoding/${token}.srt`;
}


function previewCuesFromSrt(text, maxCues = 6) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(line => /-->/.test(line));
    if (timeIndex === -1) continue;
    const textLines = lines.slice(timeIndex + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!textLines) continue;
    cues.push({ time: lines[timeIndex], text: textLines.slice(0, 220) });
    if (cues.length >= maxCues) break;
  }
  return cues;
}

export async function previewProxiedSubtitle(token, {
  maxCues = 6,
  fetcher = fetchRemoteSubtitleBuffer,
  providerLinkResolver = defaultProviderLinkResolver,
} = {}) {
  const resolved = await resolveProxiedSubtitle(token, { fetcher, providerLinkResolver });
  return {
    success: true,
    cache: resolved.cache,
    encoding: resolved.encoding,
    format: resolved.format,
    archive: resolved.archive || null,
    archiveEntry: resolved.archiveEntry || null,
    sync: resolved.sync || null,
    quality: resolved.quality || null,
    fallbackIndex: resolved.fallbackIndex || 0,
    cues: previewCuesFromSrt(resolved.text, maxCues),
  };
}
