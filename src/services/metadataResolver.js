import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';

const cache = new Map();
const pending = new Map();

function cacheKey(search) {
  return `${search.type}:${search.catalogId || search.id}`;
}

function cleanText(value) {
  return String(value || '').trim();
}

function cleanImdb(value) {
  const match = cleanText(value).match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function selectedVideo(meta, search) {
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  return videos.find(video => String(video.id || '') === String(search.id || ''))
    || videos.find(video => Number(video.season) === Number(search.season) && Number(video.episode) === Number(search.episode))
    || null;
}

function normalizeMeta(payload, search) {
  const meta = payload?.meta || payload || {};
  const video = selectedVideo(meta, search);
  const aliases = [
    meta.name,
    meta.originalName,
    meta.originalTitle,
    meta.title,
    ...(Array.isArray(meta.aliases) ? meta.aliases : []),
  ].map(cleanText).filter(Boolean);
  const runtimeMinutes = toNumber(video?.runtime || meta.runtime);
  return {
    title: cleanText(video?.name || meta.name || meta.title || search.title),
    originalTitle: cleanText(meta.originalName || meta.originalTitle || ''),
    aliases: [...new Set(aliases)],
    imdbId: cleanImdb(meta.imdb_id || meta.imdbId || search.imdbId) || search.imdbId,
    tmdbId: cleanText(meta.moviedb_id || meta.tmdb_id || meta.tmdbId || search.tmdbId) || search.tmdbId,
    year: toNumber(video?.released ? String(video.released).slice(0, 4) : meta.year) || search.year,
    season: toNumber(video?.season) || search.season,
    episode: toNumber(video?.episode) || search.episode,
    episodeTitle: cleanText(video?.name || ''),
    durationMs: runtimeMinutes ? runtimeMinutes * 60_000 : search.durationMs,
    source: 'cinemeta',
  };
}

export async function resolveMetadata(search = {}, { fetchJsonImpl = fetchJson } = {}) {
  const identity = buildVideoIdentity(search);
  if (!config.resolver.metadata.enabled || !identity.catalogId) return identity;
  const key = cacheKey(identity);
  const existing = cache.get(key);
  let payload = existing && existing.expiresAt > Date.now() ? existing.payload : null;

  try {
    if (!payload) {
      const type = identity.type === 'series' ? 'series' : 'movie';
      const url = `${config.resolver.metadata.baseUrl}/${type}/${encodeURIComponent(identity.catalogId)}.json`;
      let task = pending.get(key);
      if (!task) {
        task = fetchJsonImpl(url, {
          timeoutMs: config.resolver.metadata.timeoutMs,
          redirects: 1,
          trustedOrigin: config.resolver.metadata.baseUrl,
        }).then(responsePayload => {
          cache.set(key, {
            payload: responsePayload,
            expiresAt: Date.now() + config.resolver.metadata.cacheTtlSeconds * 1000,
          });
          return responsePayload;
        }).finally(() => {
          if (pending.get(key) === task) pending.delete(key);
        });
        pending.set(key, task);
      }
      payload = await task;
    }
    const resolved = normalizeMeta(payload, identity);
    return buildVideoIdentity({ ...identity, ...resolved, query: resolved.title || identity.query });
  } catch {
    return identity;
  }
}

export function clearMetadataCache() {
  cache.clear();
}
