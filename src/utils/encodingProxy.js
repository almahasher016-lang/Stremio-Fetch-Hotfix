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
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw httpError(400, 'Unsupported subtitle URL protocol');
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(parsed.hostname)) throw httpError(400, 'Private subtitle URL is not allowed');
  return parsed.toString();
}

export function createEncodingToken(payload) {
  const expiresAt = Math.floor(Date.now() / 1000) + config.encodingProxy.linkTtlSeconds;
  const safePayload = {
    url: assertSafeUrl(payload.url),
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
    candidate: payload.candidate ? {
      provider: payload.candidate.provider || 'unknown',
      originalProvider: payload.candidate.originalProvider || '',
      providerId: payload.candidate.providerId || payload.candidate.fileId || payload.candidate.id || '',
      id: payload.candidate.id || '',
      name: payload.candidate.name || '',
      releaseName: payload.candidate.releaseName || '',
      fileName: payload.candidate.fileName || '',
      lang: payload.candidate.lang || 'ara',
      download: payload.url,
      movieHash: payload.candidate.movieHash || payload.candidate.hash || '',
    } : null,
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
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) throw httpError(400, 'Invalid subtitle token');
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw httpError(403, 'Invalid subtitle token signature');
  const payload = JSON.parse(unb64url(encoded));
  if (payload.expiresAt && payload.expiresAt < Math.floor(Date.now() / 1000)) throw httpError(410, 'Subtitle token expired');
  payload.url = assertSafeUrl(payload.url);
  return payload;
}

async function fetchBufferFollowingRedirects(url, redirectsLeft = config.encodingProxy.maxRedirects) {
  const response = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': config.app.userAgent,
      accept: 'application/x-subrip,text/vtt,text/plain,*/*;q=0.8',
    },
    maxRedirections: 0,
    headersTimeout: config.providers.timeoutMs,
    bodyTimeout: config.providers.timeoutMs,
  });

  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    if (redirectsLeft <= 0) throw httpError(502, 'Too many subtitle redirects');
    const location = response.headers.location;
    if (!location) throw httpError(502, 'Redirect response missing location');
    const nextUrl = new URL(location, url).toString();
    return fetchBufferFollowingRedirects(assertSafeUrl(nextUrl), redirectsLeft - 1);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw httpError(502, `Subtitle upstream failed with ${response.statusCode}`);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > config.encodingProxy.maxBytes) throw httpError(413, 'Subtitle file is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function cacheKeyFor(payload) {
  const normalized = JSON.stringify({
    url: payload.url,
    options: payload.options || {},
    syncPlan: payload.syncPlan || null,
    reference: payload.reference || null,
    context: payload.context || null,
  });
  return `encoding:${sign(normalized)}`;
}

export async function resolveProxiedSubtitle(token) {
  const payload = verifyEncodingToken(token);
  const key = cacheKeyFor(payload);
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cache: 'hit' };

  const buffer = await fetchBufferFollowingRedirects(payload.url);
  const processed = processSubtitleBuffer(buffer, payload.options || {});

  let syncPlan = payload.syncPlan || null;
  if (payload.reference?.url) {
    try {
      const referenceBuffer = await fetchBufferFollowingRedirects(payload.reference.url);
      const referenceProcessed = processSubtitleBuffer(referenceBuffer, { ...payload.options, stripSdh: true });
      const referencePlan = deriveReferenceSyncPlan(processed.text, referenceProcessed.text, config.referenceSync);
      if (referencePlan.enabled) {
        syncPlan = { ...referencePlan, enabled: true, referenceProvider: payload.reference.provider, referenceName: payload.reference.name };
      }
    } catch (err) {
      console.warn('[reference-sync]', err.message);
    }
  }

  const text = applySyncPlan(processed.text, syncPlan || {});
  const quality = config.qualityGate.enabled ? analyzeSubtitleQuality(text, {
    expectedDurationMs: payload.context?.durationMs || null,
    minCues: config.qualityGate.minCues,
    minArabicRatio: config.qualityGate.minArabicRatio,
    minCoverageRatio: config.qualityGate.minCoverageRatio,
  }) : null;
  const result = {
    text,
    encoding: processed.encoding,
    format: processed.format,
    sync: syncPlan?.enabled ? syncPlan : null,
    quality,
  };
  if (payload.context && payload.candidate) {
    await versionRegistry.recordObservation({
      search: payload.context,
      candidate: { ...payload.candidate, quality },
      quality,
      sync: result.sync,
    });
  }
  await cacheSet(key, result, config.cache.subtitleTtlSeconds || config.encodingProxy.cacheTtlSeconds, config.cache.staleSeconds);
  return { ...result, cache: 'miss' };
}

export function proxiedSubtitleUrl(baseUrl, item, syncPlan = null, reference = null, context = null) {
  const download = item.download || item.url;
  if (!config.encodingProxy.enabled || !download) return download;
  const absolute = download.startsWith('/') ? `${baseUrl}${download}` : download;
  const token = createEncodingToken({
    url: absolute,
    provider: item.provider,
    name: item.name || item.releaseName,
    syncPlan,
    reference,
    candidate: item,
    context,
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
    sync: resolved.sync || null,
    quality: resolved.quality || null,
    cues: previewCuesFromSrt(resolved.text, maxCues),
  };
}
