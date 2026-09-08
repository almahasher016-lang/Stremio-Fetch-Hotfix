import { createHash } from 'node:crypto';
import { parseRelease, stableFingerprint } from './releaseParser.js';
import { buildUniversalVideoProfile } from './universalVideoIdentity.js';

const HASH_RE = /^[a-f0-9]{16,64}$/i;
const MAX_IDENTITY_TEXT = 1024;
const TECHNICAL_BOUNDARY_RE = /(?:^|\s)(?:s\d{1,3}e\d{1,4}|\d{1,3}x\d{1,4}|8640p|4320p|2160p|1440p|1080[pi]|720[pi]|576[pi]|480[pi]|8k|4k|uhd|web\s*dl|web\s*rip|webrip|webdl|blu\s*ray|bluray|bdremux|bdrip|remux|hdtv|dvdrip|hdcam|telesync|telecine|x264|x265|h264|h265|hevc|avc|av1|vp9|hdr10\+?|hdr|dolby\s*vision|dovi|truehd|dts|ddp|eac3|aac|atmos|extended|theatrical|unrated|director(?:'s|s)?\s*cut|imax)(?=\s|$)/i;

function firstDefined(values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function cleanText(value) {
  return String(value ?? '').slice(0, MAX_IDENTITY_TEXT).trim();
}

function isAsciiAlphaNumeric(char) {
  const code = char.codePointAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '' || char === '\f' || char === '\v';
}

function normalizeFilenameSeparators(value) {
  const input = cleanText(value);
  const lastDot = input.lastIndexOf('.');
  let base = input;
  if (lastDot >= 0) {
    const extension = input.slice(lastDot + 1);
    if (extension.length >= 1 && extension.length <= 12 && [...extension].every(isAsciiAlphaNumeric)) {
      base = input.slice(0, lastDot);
    }
  }
  let output = '';
  let pendingSpace = false;
  for (const char of base) {
    if (char === '.' || char === '_' || char === '-' || isWhitespace(char)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) { output += ' '; pendingSpace = false; }
    output += char;
  }
  return output.trim();
}

function cleanImdb(value) {
  const match = cleanText(value).match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function normalizeHash(value) {
  const normalized = cleanText(value).toLowerCase();
  return HASH_RE.test(normalized) ? normalized : null;
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function toFiniteNumber(value, min, max, precision = 3) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Number(number.toFixed(precision));
}

function technicalText(value, maxLength = 64) {
  const text = cleanText(value).toLowerCase();
  return text && text.length <= maxLength ? text : null;
}

function normalizeEpisode(value, min = 1) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= 9999 ? number : null;
}

function extractPrefixedId(prefix, value) {
  const match = cleanText(value).match(new RegExp(`(?:^|:)${prefix}:([^:]+)`, 'i'));
  return match ? match[1] : null;
}

function routeEpisode(id, type) {
  if (type !== 'series') return { season: null, episode: null };
  const parts = cleanText(id).split(':');
  if (parts.length < 3) return { season: null, episode: null };
  return {
    season: normalizeEpisode(parts.at(-2), 0),
    episode: normalizeEpisode(parts.at(-1)),
  };
}

function deriveTitleFromFilename(filename, parsed = {}) {
  let value = normalizeFilenameSeparators(filename);
  if (!value) return '';
  const boundary = value.match(TECHNICAL_BOUNDARY_RE);
  if (boundary?.index > 0) value = value.slice(0, boundary.index).trim();
  const yearSuffix = parsed.year ? ` ${parsed.year}` : '';
  if (yearSuffix && value.endsWith(yearSuffix)) value = value.slice(0, - yearSuffix.length).trim();
  return value;
}

export function normalizeStremioExtra(extra = {}) {
  const raw = extra && typeof extra === 'object' ? extra : {};
  const videoId = firstDefined([raw.videoId, raw.videoID, raw.video_id, raw.contentId, raw.contentID]);
  const videoHash = firstDefined([raw.videoHash, raw.videohash, raw.video_hash, raw.movieHash, raw.moviehash, raw.hash]);
  const videoSize = firstDefined([raw.videoSize, raw.video_size, raw.moviebytesize, raw.size]);
  const filename = firstDefined([raw.filename, raw.fileName, raw.file_name, raw.videoName, raw.name]);
  const title = firstDefined([raw.title, raw.name, raw.query, raw.q]);
  return {
    ...raw,
    videoId: cleanText(videoId),
    videoHash: normalizeHash(videoHash),
    videoSize: toPositiveNumber(videoSize),
    filename: cleanText(filename),
    title: cleanText(title),
  };
}

export function isVideoHash(value) {
  return Boolean(normalizeHash(value));
}

export function stableKey(value) {
  return createHash('sha256').update(cleanText(value)).digest('hex').slice(0, 24);
}

export function buildVideoIdentity({ type = 'movie', id, extra = {}, ...input } = {}) {
  const normalizedExtra = normalizeStremioExtra(extra);
  const routeId = cleanText(id || input.videoId || normalizedExtra.videoId);
  const legacyHash = isVideoHash(routeId) ? normalizeHash(routeId) : null;
  const videoId = normalizedExtra.videoId || (legacyHash ? '' : routeId);
  const hash = normalizedExtra.videoHash || legacyHash || normalizeHash(input.videoHash || input.hash);
  const filename = cleanText(input.filename || normalizedExtra.filename);
  const explicitTitle = cleanText(input.title || normalizedExtra.title || input.query);
  const parsed = parseRelease(filename || explicitTitle || routeId);
  const title = explicitTitle || deriveTitleFromFilename(filename, parsed) || cleanText(videoId || routeId);
  const routeSe = routeEpisode(videoId || routeId, type);
  const imdbId = cleanImdb(input.imdbId || normalizedExtra.imdbId || normalizedExtra.imdb_id || videoId || routeId || filename);
  const tmdbId = cleanText(input.tmdbId || normalizedExtra.tmdbId || normalizedExtra.tmdb_id || extractPrefixedId('tmdb', videoId || routeId));
  const kitsuId = cleanText(input.kitsuId || normalizedExtra.kitsuId || extractPrefixedId('kitsu', videoId || routeId));
  const anidbId = cleanText(input.anidbId || normalizedExtra.anidbId || extractPrefixedId('anidb', videoId || routeId));
  const malId = cleanText(input.malId || normalizedExtra.malId || extractPrefixedId('mal', videoId || routeId));
  const season = normalizeEpisode(input.season ?? normalizedExtra.season ?? routeSe.season ?? parsed.season, 0);
  const episode = normalizeEpisode(input.episode ?? normalizedExtra.episode ?? routeSe.episode ?? parsed.episode);
  const catalogId = cleanText(imdbId || (tmdbId ? `tmdb:${tmdbId}` : '') || (kitsuId ? `kitsu:${kitsuId}` : '') || (anidbId ? `anidb:${anidbId}` : '') || (malId ? `mal:${malId}` : '') || videoId || routeId);
  const releaseFingerprint = stableFingerprint(filename || title || catalogId);
  const videoSize = toPositiveNumber(input.videoSize || normalizedExtra.videoSize);
  const durationMs = toPositiveNumber(input.durationMs || normalizedExtra.durationMs || normalizedExtra.duration);
  const fps = toFiniteNumber(input.fps ?? normalizedExtra.fps ?? normalizedExtra.frameRate ?? normalizedExtra.frame_rate, 1, 240);
  const width = toPositiveNumber(input.width ?? normalizedExtra.width);
  const height = toPositiveNumber(input.height ?? normalizedExtra.height);
  const resolution = technicalText(input.resolution ?? normalizedExtra.resolution ?? normalizedExtra.video_resolution);
  const videoCodec = technicalText(input.videoCodec ?? input.video_codec ?? normalizedExtra.videoCodec ?? normalizedExtra.video_codec);
  const pixelFormat = technicalText(input.pixelFormat ?? input.pixel_format ?? normalizedExtra.pixelFormat ?? normalizedExtra.pixel_format);
  const hdr = technicalText(input.hdr ?? normalizedExtra.hdr);
  const audioCodec = technicalText(input.audioCodec ?? input.audio_codec ?? normalizedExtra.audioCodec ?? normalizedExtra.audio_codec);
  const audioChannels = technicalText(input.audioChannels ?? input.audio_channels ?? normalizedExtra.audioChannels ?? normalizedExtra.audio_channels);
  const container = technicalText(input.container ?? normalizedExtra.container);
  const enrichedExtra = {
    ...normalizedExtra,
    ...(fps && !normalizedExtra.fps ? { fps } : {}),
    ...(durationMs && !normalizedExtra.durationMs ? { durationMs } : {}),
    ...(resolution && !normalizedExtra.resolution ? { resolution } : {}),
    ...(videoCodec && !normalizedExtra.videoCodec ? { videoCodec } : {}),
    ...(hdr && !normalizedExtra.hdr ? { hdr } : {}),
    ...(audioCodec && !normalizedExtra.audioCodec ? { audioCodec } : {}),
    ...(audioChannels && !normalizedExtra.audioChannels ? { audioChannels } : {}),
    ...(container && !normalizedExtra.container ? { container } : {}),
  };
  const videoProfile = buildUniversalVideoProfile({
    ...input,
    filename,
    videoHash: hash,
    videoSize,
    durationMs,
    fps,
    width,
    height,
    resolution,
    videoCodec,
    hdr,
    container,
    parsedRelease: parsed,
    extra: enrichedExtra,
  });
  return {
    ...input,
    type,
    id: videoId || routeId || catalogId,
    routeId,
    videoId,
    videoHash: hash,
    videoSize,
    filename,
    title,
    query: cleanText(input.query || title || catalogId),
    imdbId,
    tmdbId: tmdbId || null,
    kitsuId: kitsuId || null,
    anidbId: anidbId || null,
    malId: malId || null,
    catalogId,
    season,
    episode,
    year: toPositiveNumber(input.year || normalizedExtra.year || parsed.year),
    durationMs: videoProfile.durationMs || durationMs,
    fps: videoProfile.fps || fps,
    width,
    height,
    resolution: videoProfile.resolution || resolution,
    videoCodec: videoProfile.codec || videoCodec,
    pixelFormat,
    hdr: videoProfile.hdr || hdr,
    audioCodec,
    audioChannels,
    container: videoProfile.container || container,
    releaseFingerprint,
    timingFingerprint: stableKey(videoProfile.timingSignature),
    parsedRelease: parsed,
    videoProfile,
    extra: enrichedExtra,
  };
}

export function versionKeys(search = {}) {
  const identity = search.releaseFingerprint ? search : buildVideoIdentity(search);
  const keys = [];
  if (identity.videoHash && identity.videoSize) keys.push(`hash-size:${identity.videoHash}:${identity.videoSize}`);
  if (identity.videoHash) keys.push(`hash:${identity.videoHash}`);
  if (identity.catalogId && identity.season != null && identity.episode) keys.push(`episode:${identity.catalogId}:s${identity.season}:e${identity.episode}`);
  if (identity.catalogId && !identity.season && !identity.episode) keys.push(`movie:${identity.catalogId}`);
  if (identity.catalogId && identity.releaseFingerprint) keys.push(`release:${identity.catalogId}:${stableKey(identity.releaseFingerprint)}`);
  if (identity.catalogId && identity.timingFingerprint) keys.push(`timeline:${identity.catalogId}:${identity.timingFingerprint}`);
  return [...new Set(keys)];
}

export function assetKey(item = {}) {
  const provider = cleanText(item.provider || item.originalProvider || 'unknown').toLowerCase();
  const providerId = cleanText(item.providerId || item.id || item.fileId);
  const download = cleanText(item.download || item.url);
  const name = cleanText(item.releaseName || item.fileName || item.name);
  return `${provider}:${stableKey(providerId || download || name)}`;
}
