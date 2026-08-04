import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { cacheGet, cacheSet } from '../cache/redis.js';
import {
  createEncodingToken,
  fetchRemoteSubtitleBuffer,
  verifyEncodingToken,
} from './encodingProxy.js';
import { extractSubtitlePayload } from './subtitleArchive.js';
import { decodeSubtitleBuffer, normalizeArabicPresentationForms } from './subtitleEncoding.js';
import { httpError } from './httpError.js';
import { getVaultSubtitle } from '../services/vaultService.js';
import { getOpenSubtitlesDownloadLink } from '../providers/openSubtitles.js';
import { getSubsourceDownloadLink } from '../providers/subsource.js';

const STYLED_FORMATS = new Set(['ass', 'ssa']);
const ARABIC_RE = /\p{Script_Extensions=Arabic}/gu;
const LETTER_RE = /\p{L}/gu;

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function validVaultId(value) {
  const id = String(value || '').replace(/^vault-/, '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw httpError(400, 'Invalid vault subtitle source');
  return id;
}

function absoluteDownloadUrl(baseUrl, item) {
  const download = item?.download || item?.url;
  if (!download) return null;
  return download.startsWith('/') ? `${baseUrl}${download}` : download;
}

export function styledSubtitleFormatHint(item = {}) {
  const provider = lower(item.originalProvider || item.provider);
  if (provider === 'vault' || item.provider === 'vault') return null;

  for (const value of [item.format, item.subtitleFormat, item.fileFormat, item.extension, item.fileExtension]) {
    const normalized = lower(value).replace(/^\./, '');
    if (STYLED_FORMATS.has(normalized)) return normalized;
  }

  const values = [item.fileName, item.filename, item.name, item.releaseName, item.download, item.url];
  for (const value of values) {
    const match = String(value || '').match(/\.(ass|ssa)(?:\.(?:zip|gz|xz))?(?:$|[?#])/i);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function tokenSourceForItem(baseUrl, item) {
  const provider = lower(item.originalProvider || item.provider || 'unknown');
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
  if (!absolute) throw httpError(400, 'Styled subtitle source is missing');
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
        name: item.fileName || item.name || item.releaseName,
        candidate: item,
      };
    }
  } catch {
    // createEncodingToken validates malformed and unsafe remote URLs.
  }

  return {
    kind: 'remote',
    url: absolute,
    provider,
    name: item.fileName || item.name || item.releaseName,
    candidate: item,
  };
}

export function styledSubtitleUrl(baseUrl, item, context = null) {
  if (!config.encodingProxy.enabled) return null;
  const format = styledSubtitleFormatHint(item);
  if (!format) return null;
  const token = createEncodingToken({
    source: tokenSourceForItem(baseUrl, item),
    options: { styledFormat: format },
    context,
  });
  return `${baseUrl}/proxy/styled/${token}.${format}`;
}

async function defaultProviderLinkResolver(source) {
  return source.provider === 'opensubtitles'
    ? getOpenSubtitlesDownloadLink(source.providerId, { subFormat: null })
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

function splitAssFields(value, count) {
  const fields = [];
  let remaining = String(value || '');
  for (let index = 0; index < count - 1; index += 1) {
    const comma = remaining.indexOf(',');
    if (comma === -1) return [];
    fields.push(remaining.slice(0, comma));
    remaining = remaining.slice(comma + 1);
  }
  fields.push(remaining);
  return fields;
}

function assTimestampMs(value) {
  const match = String(value || '').trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!match) return null;
  const milliseconds = Number(match[4].padEnd(3, '0').slice(0, 3));
  return (((Number(match[1]) * 60 + Number(match[2])) * 60) + Number(match[3])) * 1000 + milliseconds;
}

function visibleDialogueText(value) {
  const raw = String(value || '');
  let drawing = false;
  const visible = raw.split(/(\{[^}]*\})/g).map(token => {
    if (!token.startsWith('{')) return drawing ? '' : token;
    for (const match of token.matchAll(/\\p(-?\d+(?:\.\d+)?)/gi)) drawing = Number(match[1]) !== 0;
    return token;
  }).join('');
  return visible
    .replace(/\{\\[^}]+}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function detectStyledFormat(text, sourceName, requestedFormat) {
  const requested = lower(requestedFormat).replace(/^\./, '');
  if (STYLED_FORMATS.has(requested)) return requested;
  const extension = String(sourceName || '').match(/\.(ass|ssa)(?:\.(?:zip|gz|xz))?(?:$|[?#])/i)?.[1]?.toLowerCase();
  if (extension) return extension;
  const scriptType = String(text || '').match(/^\s*ScriptType\s*:\s*v?([^\r\n]+)/im)?.[1]?.trim();
  return scriptType && !scriptType.includes('+') ? 'ssa' : 'ass';
}

export function analyzeStyledSubtitle(text, {
  expectedDurationMs = null,
  qualityGate = config.qualityGate,
} = {}) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const defaultFormat = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  let format = defaultFormat;
  let inEvents = false;
  let cues = 0;
  let maxEndMs = 0;
  let arabicCount = 0;
  let letterCount = 0;

  for (const rawLine of lines) {
    const section = rawLine.trim().match(/^\[([^\]]+)]$/);
    if (section) {
      inEvents = section[1].trim().toLowerCase() === 'events';
      continue;
    }
    if (!inEvents) continue;

    const formatMatch = rawLine.match(/^\s*Format\s*:\s*(.+)$/i);
    if (formatMatch) {
      const fields = formatMatch[1].split(',').map(field => field.trim().toLowerCase()).filter(Boolean);
      if (fields.includes('start') && fields.includes('end') && fields.includes('text')) format = fields;
      continue;
    }

    const dialogue = rawLine.match(/^\s*Dialogue\s*:\s*(.*)$/i);
    if (!dialogue) continue;
    const values = splitAssFields(dialogue[1], format.length);
    if (!values.length) continue;
    const startIndex = format.indexOf('start');
    const endIndex = format.indexOf('end');
    const textIndex = format.indexOf('text');
    const startMs = assTimestampMs(values[startIndex]);
    const endMs = assTimestampMs(values[endIndex]);
    const visible = visibleDialogueText(values[textIndex]);
    if (startMs === null || endMs === null || endMs <= startMs || !visible) continue;
    cues += 1;
    maxEndMs = Math.max(maxEndMs, endMs);
    arabicCount += (visible.match(ARABIC_RE) || []).length;
    letterCount += (visible.match(LETTER_RE) || []).length;
  }

  const arabicRatio = arabicCount / Math.max(1, letterCount);
  const duration = Number(expectedDurationMs);
  const coverageRatio = Number.isFinite(duration) && duration > 0
    ? Math.min(1, maxEndMs / duration)
    : null;
  const reasons = [];
  if (!cues) reasons.push('no-valid-ass-dialogues');
  if (qualityGate?.enabled) {
    if (cues < Number(qualityGate.minCues || 0)) reasons.push('too-few-cues');
    if (arabicRatio < Number(qualityGate.minArabicRatio || 0)) reasons.push('low-arabic-ratio');
    if (coverageRatio !== null && coverageRatio < Number(qualityGate.minCoverageRatio || 0)) reasons.push('low-duration-coverage');
  }
  return {
    valid: reasons.length === 0,
    cues,
    arabicRatio: Number(arabicRatio.toFixed(4)),
    coverageRatio: coverageRatio === null ? null : Number(coverageRatio.toFixed(4)),
    maxEndMs,
    reasons,
  };
}

export function normalizeStyledSubtitleBuffer(buffer, {
  sourceName = '',
  requestedFormat = null,
  encodingHint = null,
  expectedDurationMs = null,
  qualityGate = config.qualityGate,
} = {}) {
  const decoded = decodeSubtitleBuffer(buffer, { encodingHint });
  const text = normalizeArabicPresentationForms(decoded.text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trimEnd() + '\n';
  if (!/^\s*\[(?:Script Info|V4\+? Styles|Events)]/im.test(text) || !/^\s*Dialogue\s*:/im.test(text)) {
    throw httpError(422, 'Subtitle payload is not a valid ASS/SSA script');
  }
  const quality = analyzeStyledSubtitle(text, { expectedDurationMs, qualityGate });
  if (!quality.valid) {
    const error = httpError(422, 'Styled subtitle failed quality validation');
    error.code = 'STYLED_SUBTITLE_QUALITY_REJECTED';
    error.quality = quality;
    throw error;
  }
  return {
    text,
    encoding: decoded.encoding,
    format: detectStyledFormat(text, sourceName, requestedFormat),
    quality,
  };
}

function styledCacheKey(token) {
  return `styled:v4:${createHash('sha256').update(String(token)).digest('hex')}`;
}

export async function resolveStyledSubtitle(token, {
  fetcher = fetchRemoteSubtitleBuffer,
  providerLinkResolver = defaultProviderLinkResolver,
} = {}) {
  const payload = verifyEncodingToken(token);
  const key = styledCacheKey(token);
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cache: 'hit' };

  const source = payload.source;
  const buffer = await fetchSourceBuffer(source, fetcher, providerLinkResolver);
  const extracted = await extractSubtitlePayload(buffer, {
    maxDecompressedBytes: config.encodingProxy.maxDecompressedBytes,
    maxArchiveEntries: config.encodingProxy.maxArchiveEntries,
    sourceName: source.name || source.candidate?.fileName || source.candidate?.name,
    allowedExtensions: ['ass', 'ssa'],
  });
  const normalized = normalizeStyledSubtitleBuffer(extracted.buffer, {
    sourceName: extracted.entryName || source.name || source.candidate?.fileName,
    requestedFormat: payload.options?.styledFormat,
    encodingHint: payload.options?.encodingHint,
    expectedDurationMs: payload.context?.durationMs || null,
  });
  const result = {
    ...normalized,
    archive: extracted.archive,
    archiveEntry: extracted.entryName,
  };
  await cacheSet(
    key,
    result,
    config.cache.subtitleTtlSeconds || config.encodingProxy.cacheTtlSeconds,
    config.cache.staleSeconds,
  );
  return { ...result, cache: 'miss' };
}
