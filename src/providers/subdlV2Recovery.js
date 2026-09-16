import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage } from '../utils/language.js';
import { expandSubdlSubtitles, searchSubdl } from './subdl.js';

function cleanFilename(value) {
  return String(value || '')
    .normalize('NFKC')
    .split(/[\\/]/)
    .at(-1)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240);
}

function normalizedImdb(value) {
  const digits = String(value || '').replace(/^tt/i, '').replace(/\D/g, '');
  return digits ? `tt${digits}` : '';
}

function conflictsWithPlayback(payload, variant) {
  const catalog = Array.isArray(payload?.results) ? payload.results[0] : null;
  const matched = payload?.match || {};
  const requestedId = normalizedImdb(variant.imdbId);
  const actualId = normalizedImdb(catalog?.imdb_id || matched.imdb_id);
  if (requestedId && actualId && requestedId !== actualId) return true;
  const mediaType = String(matched.type || catalog?.type || '').toLowerCase();
  if (mediaType && (variant.type === 'series' ? !['tv', 'series', 'episode'].includes(mediaType) : !['movie', 'film'].includes(mediaType))) return true;
  if (variant.type === 'series') {
    const season = matched.season ?? matched.season_number;
    const episode = matched.episode ?? matched.episode_number;
    if (season != null && season !== '' && Number(season) !== Number(variant.season)) return true;
    if (episode != null && episode !== '' && Number(episode) !== Number(variant.episode)) return true;
  }
  return false;
}

function safeSubdlDownload(value, downloadBaseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const origin = new URL(downloadBaseUrl).origin;
  if (raw.startsWith('/')) return /^\/subtitle\//i.test(raw);
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === origin && /^\/subtitle\//i.test(url.pathname);
  } catch {
    return false;
  }
}

// V2 filename search is a discovery source, never a hash match or timing certificate.
// Only use its returned file URLs and explicit language/identity, and leave the existing
// download preflight and V5 proof engine responsible for validation and classification.
export async function searchSubdlV2Filename(variant, {
  fetchJsonImpl = fetchJson,
  configImpl = config,
} = {}) {
  if (!configImpl.subdl.apiKey || !variant.filename) return [];
  const filename = cleanFilename(variant.filename);
  if (!filename) return [];
  const language = isEnglishLanguage(variant.language) ? 'en' : 'ar';
  const params = new URLSearchParams({
    filename,
    languages: language,
    subs_per_page: String(Math.min(30, Math.max(1, configImpl.providers.maxProviderItems))),
  });
  const apiOrigin = new URL(configImpl.subdl.baseUrl).origin;
  const payload = await fetchJsonImpl(`${apiOrigin}/api/v2/files/search?${params}`, {
    headers: { Authorization: `Bearer ${configImpl.subdl.apiKey}`, Accept: 'application/json' },
    signal: variant.signal,
    trustedOrigin: apiOrigin,
  });
  if (payload?.error || payload?.status === false) throw new Error('SubDL v2 filename search failed');
  if (conflictsWithPlayback(payload, variant)) return [];

  const catalog = Array.isArray(payload?.results) ? payload.results[0] : null;
  const rows = (Array.isArray(payload?.subtitles) ? payload.subtitles : [])
    .filter(item => {
      const label = item.lang || item.language || item.language_code || item.language_name;
      return label && (language === 'en' ? isEnglishLanguage(label) : isArabicLanguage(label));
    })
    .filter(item => safeSubdlDownload(item.url || item.download_link, configImpl.subdl.downloadBaseUrl))
    .filter(item => variant.type !== 'series'
      || ((item.season == null && item.season_number == null)
        || Number(item.season ?? item.season_number) === Number(variant.season)))
    .filter(item => variant.type !== 'series'
      || ((item.episode == null && item.episode_number == null)
        || Number(item.episode ?? item.episode_number) === Number(variant.episode)))
    .map(item => ({
      ...item,
      imdb_id: item.imdb_id || catalog?.imdb_id || null,
      tmdb_id: item.tmdb_id || catalog?.tmdb_id || null,
      type: item.type || catalog?.type || null,
    }));

  return expandSubdlSubtitles(rows, language, variant, configImpl)
    .slice(0, configImpl.providers.maxProviderItems);
}

export async function searchSubdlWithV2Recovery(variant, options = {}) {
  const configImpl = options.configImpl || config;
  if (!configImpl.subdl.apiKey) return [];
  let discovered = [];
  if (variant.filename) {
    try {
      discovered = await searchSubdlV2Filename(variant, options);
    } catch (error) {
      if (variant.signal?.aborted || error?.name === 'AbortError') throw error;
      // A v2 outage, unsupported account or unexpected schema must not remove v1 coverage.
    }
  }

  let legacy = [];
  try {
    legacy = await searchSubdl(variant, options);
  } catch (error) {
    if (variant.signal?.aborted || error?.name === 'AbortError' || !discovered.length) throw error;
  }

  const seen = new Set();
  return [...discovered, ...legacy].filter(item => {
    const key = item.md5 || item.download || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, configImpl.providers.maxProviderItems);
}
