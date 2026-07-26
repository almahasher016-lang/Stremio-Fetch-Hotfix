import { createHmac, timingSafeEqual } from 'node:crypto';
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

const MAX_TOKEN_LENGTH = 32_768;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const SRT_CUE_RE = /\d{2,3}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2},\d{3}/;
const YIFY_BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function unb64url(input) {
  return Buffer.from(String(input), 'base64url').toString('utf8');
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

function compactTokenCandidate(candidate, download) {
  if (!candidate) return null;
  return {
    provider: candidate.provider || 'unknown',
    originalProvider: candidate.originalProvider || '',
    providerId: candidate.providerId || candidate.fileId || candidate.id || '',
    id: candidate.id || '',
    name: candidate.name || '',
    releaseName: candidate.releaseName || '',
    fileName: candidate.fileName || '',
    lang: candidate.lang || 'ara',
    download,
    movieHash: candidate.movieHash || candidate.hash || '',
  };
}

function compactTokenFallback(fallback) {
  const url = assertSafeUrl(fallback.url);
  return {
    url,
    name: fallback.name || '',
    provider: fallback.provider || 'unknown',
    candidate: compactTokenCandidate(fallback.candidate, url),
  };
}

export function createEncodingToken(payload) {
  const expiresAt = Math.floor(Date.now() / 1000) + config.encodingProxy.linkTtlSeconds;
  const primaryUrl = assertSafeUrl(payload.url);
  const safePayload = {
    url: primaryUrl,
    name: payload.name || '',
    provider: payload.provider || 'unknown',
    options: {
      stripSdh: config.encodingProxy.stripSdhDefault,
      stripMusicNotes: config.encodingProxy.stripMusicNotes,
      ...(payload.options || {}),
    },
    syncPlan: payload.syncPlan || null,
    reference: payload.reference ? {
      url: assertSafeUrl(payload.reference.url),
      name: payload.reference.name || '',
      provider: payload.reference.provider || 'unknown',
    } : null,
    candidate: compactTokenCandidate(payload.candidate, primaryUrl),
    fallbacks: Array.isArray(payload.fallbacks)
      ? payload.fallbacks.slice(0, config.encodingProxy.maxFallbacks).map(compactTokenFallback)
      : [],
    context: payload.context ? {
      type: payload.context.type || 'movie',
      id: payload.context.id || '',
      videoId: payload.context.videoId || '',
      videoHash: payload.context.videoHash || '',
      videoSize: payload.context.videoSize || null,
      filename: payload.context.filename || '',
      title: payload.context.title || '',
      imdbId: payload.context.imdbId || '',
      tmdbId: payload.context.tmdbId || '',
      season: payload.context.season || null,
      episode: payload.context.episode || null,
      durationMs: payload.context.durationMs || null,
    } : null,
    expiresAt,
  };
  const encoded = b64url(JSON.stringify(safePayload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyEncodingToken(token) {
  const raw = String(token || '');
  if (!raw || raw.length > MAX_TOKEN_LENGTH) throw httpError(400, 'Invalid subtitle token');
  const parts = raw.split('.');
  if (parts.length !== 2) throw httpError(400, 'Invalid subtitle token');
  const [encoded, signature] = parts;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw httpError(403, 'Invalid subtitle token signature');
  let payload;
  try {
    payload = JSON.parse(unb64url(encoded));
  } catch {
    throw httpError(400, 'Invalid subtitle token payload');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpError(400, 'Invalid subtitle token payload');
  if (payload.expiresAt && payload.expiresAt < Math.floor(Date.now() / 1000)) throw httpError(410, 'Subtitle token expired');
  payload.url = assertSafeUrl(payload.url);
  if (payload.reference?.url) payload.reference.url = assertSafeUrl(payload.reference.url);
  if (payload.fallbacks !== undefined && !Array.isArray(payload.fallbacks)) throw httpError(400, 'Invalid subtitle fallback payload');
  payload.fallbacks = (payload.fallbacks || []).slice(0, config.encodingProxy.maxFallbacks).map(fallback => ({
    ...fallback,
    url: assertSafeUrl(fallback?.url),
  }));
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
    url: payload.url,
    fallbacks: payload.fallbacks || [],
    options: payload.options || {},
    syncPlan: payload.syncPlan || null,
    reference: payload.reference || null,
    context: payload.context || null,
  });
  return `encoding:v5:${sign(normalized)}`;
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

async function loadProcessedSource(source, payload) {
  const buffer = await fetchRemoteSubtitleBuffer(source.url, { provider: source.provider });
  const extracted = await extractSubtitlePayload(buffer, {
    maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
    maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
    sourceName: source.name,
  });
  const processed = processSubtitleBuffer(extracted.buffer, payload.options || {});
  assertValidProcessedSubtitle(processed.text);
  const quality = analyzeProcessedSubtitle(processed.text, payload.context);
  if (quality?.reasons.includes('low-arabic-ratio')) {
    const error = httpError(422, 'Subtitle payload failed Arabic language validation');
    error.code = 'LOW_ARABIC_RATIO';
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
      candidate: { ...source.candidate, quality },
      note: 'Automatic rejection: downloaded content failed the Arabic language gate',
    });
  } catch (error) {
    console.warn('[quality-gate:reject]', error.message);
  }
}

async function selectProcessedSource(payload) {
  const sources = [{
    url: payload.url,
    name: payload.name,
    provider: payload.provider,
    candidate: payload.candidate,
  }, ...(payload.fallbacks || [])];
  let lastError = null;
  for (const [fallbackIndex, source] of sources.entries()) {
    try {
      return { ...(await loadProcessedSource(source, payload)), fallbackIndex };
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') throw error;
      if (error?.code === 'LOW_ARABIC_RATIO') {
        await rejectMislabeledSource(payload, source, error.quality);
      }
    }
  }
  throw lastError || httpError(502, 'No usable Arabic subtitle source');
}

export async function resolveProxiedSubtitle(token) {
  const payload = verifyEncodingToken(token);
  const key = cacheKeyFor(payload);
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cache: 'hit' };

  const selected = await selectProcessedSource(payload);
  const { source, extracted, processed, fallbackIndex } = selected;

  let syncPlan = fallbackIndex === 0 ? (payload.syncPlan || null) : null;
  if (payload.reference?.url) {
    try {
      const referenceBuffer = await fetchRemoteSubtitleBuffer(payload.reference.url, { provider: payload.reference.provider });
      const referenceExtracted = await extractSubtitlePayload(referenceBuffer, {
        maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
        maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
        sourceName: payload.reference.name,
      });
      const referenceProcessed = processSubtitleBuffer(referenceExtracted.buffer, { ...payload.options, stripSdh: true });
      const referencePlan = deriveReferenceSyncPlan(processed.text, referenceProcessed.text, config.referenceSync);
      if (referencePlan.enabled) {
        syncPlan = { ...referencePlan, enabled: true, referenceProvider: payload.reference.provider, referenceName: payload.reference.name };
      }
    } catch (err) {
      console.warn('[reference-sync]', err.message);
    }
  }

  const text = applySyncPlan(processed.text, syncPlan || {});
  assertValidProcessedSubtitle(text);
  const quality = analyzeProcessedSubtitle(text, payload.context);
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
      candidate: { ...source.candidate, quality },
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

export function proxiedSubtitleUrl(baseUrl, item, syncPlan = null, reference = null, context = null, fallbackItems = []) {
  const absolute = absoluteDownloadUrl(baseUrl, item);
  if (!config.encodingProxy.enabled || !absolute) return absolute;
  const fallbacks = fallbackItems
    .map(fallback => {
      const url = absoluteDownloadUrl(baseUrl, fallback);
      return url ? {
        url,
        provider: fallback.provider,
        name: fallback.name || fallback.releaseName,
        candidate: fallback,
      } : null;
    })
    .filter(Boolean)
    .slice(0, config.encodingProxy.maxFallbacks);
  const token = createEncodingToken({
    url: absolute,
    provider: item.provider,
    name: item.name || item.releaseName,
    syncPlan,
    reference,
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

export async function previewProxiedSubtitle(token, { maxCues = 6 } = {}) {
  const resolved = await resolveProxiedSubtitle(token);
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
