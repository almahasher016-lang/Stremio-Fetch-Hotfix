import { createHash } from 'node:crypto';
import { parseRelease, stableFingerprint } from './releaseParser.js';

const HASH_RE = /^[a-f0-9]{16,64}$/i;

function firstDefined(values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function cleanText(value) {
  return String(value || '').trim();
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

function normalizeEpisode(value) {
  const number = toPositiveNumber(value);
  return number && number <= 9999 ? number : null;
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
    season: normalizeEpisode(parts.at(-2)),
    episode: normalizeEpisode(parts.at(-1)),
  };
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
  const title = cleanText(input.title || normalizedExtra.title || input.query || filename || videoId || routeId);
  const parsed = parseRelease(filename || title || routeId);
  const routeSe = routeEpisode(videoId || routeId, type);
  const imdbId = cleanImdb(input.imdbId || normalizedExtra.imdbId || normalizedExtra.imdb_id || videoId || routeId || filename);
  const tmdbId = cleanText(input.tmdbId || normalizedExtra.tmdbId || normalizedExtra.tmdb_id || extractPrefixedId('tmdb', videoId || routeId));
  const kitsuId = cleanText(input.kitsuId || normalizedExtra.kitsuId || extractPrefixedId('kitsu', videoId || routeId));
  const anidbId = cleanText(input.anidbId || normalizedExtra.anidbId || extractPrefixedId('anidb', videoId || routeId));
  const malId = cleanText(input.malId || normalizedExtra.malId || extractPrefixedId('mal', videoId || routeId));
  const season = normalizeEpisode(input.season || normalizedExtra.season || parsed.season || routeSe.season);
  const episode = normalizeEpisode(input.episode || normalizedExtra.episode || parsed.episode || routeSe.episode);
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
    ...(resolution && !normalizedExtra.resolution ? { resolution } : {}),
    ...(videoCodec && !normalizedExtra.videoCodec ? { videoCodec } : {}),
    ...(hdr && !normalizedExtra.hdr ? { hdr } : {}),
    ...(audioCodec && !normalizedExtra.audioCodec ? { audioCodec } : {}),
    ...(audioChannels && !normalizedExtra.audioChannels ? { audioChannels } : {}),
  };
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
    durationMs,
    fps,
    width,
    height,
    resolution,
    videoCodec,
    pixelFormat,
    hdr,
    audioCodec,
    audioChannels,
    container,
    releaseFingerprint,
    parsedRelease: parsed,
    extra: enrichedExtra,
  };
}

export function versionKeys(search = {}) {
  const identity = search.releaseFingerprint ? search : buildVideoIdentity(search);
  const keys = [];
  if (identity.videoHash && identity.videoSize) keys.push(`hash-size:${identity.videoHash}:${identity.videoSize}`);
  if (identity.videoHash) keys.push(`hash:${identity.videoHash}`);
  if (identity.catalogId && identity.season && identity.episode) keys.push(`episode:${identity.catalogId}:s${identity.season}:e${identity.episode}`);
  if (identity.catalogId && !identity.season && !identity.episode) keys.push(`movie:${identity.catalogId}`);
  if (identity.catalogId && identity.releaseFingerprint) keys.push(`release:${identity.catalogId}:${stableKey(identity.releaseFingerprint)}`);
  return [...new Set(keys)];
}

export function assetKey(item = {}) {
  const provider = cleanText(item.provider || item.originalProvider || 'unknown').toLowerCase();
  const providerId = cleanText(item.providerId || item.id || item.fileId);
  const download = cleanText(item.download || item.url);
  const name = cleanText(item.releaseName || item.fileName || item.name);
  return `${provider}:${stableKey(providerId || download || name)}`;
}
