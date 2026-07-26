import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage, providerLanguageParam } from '../utils/language.js';

function osHeaders(extra = {}) {
  const headers = {
    'Api-Key': config.openSubtitles.apiKey,
    'User-Agent': config.app.userAgent,
    ...extra,
  };
  if (config.openSubtitles.token) headers.Authorization = `Bearer ${config.openSubtitles.token}`;
  return headers;
}

function cleanImdb(value) {
  if (!value) return null;
  return String(value).replace(/^tt/i, '').replace(/\D/g, '') || null;
}

function addParam(params, key, value) {
  if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
}

function normalizeItem(item, expectedLanguage = 'ar', variant = {}) {
  const attr = item.attributes || item;
  const files = attr.files || item.files || [];
  const firstFile = files[0] || {};
  const language = attr.language || attr.lang || attr.iso639 || (expectedLanguage === 'en' ? 'eng' : 'ara');
  const isExpected = expectedLanguage === 'en' ? isEnglishLanguage(language) : isArabicLanguage(language);
  if (!isExpected) return null;

  const fileId = firstFile.file_id || firstFile.fileId || attr.file_id || item.file_id;
  const movieHash = attr.moviehash || attr.movie_hash || attr.feature_details?.moviehash || null;
  const matchedByHash = Boolean(attr.moviehash_match || attr.movie_hash_match)
    || Boolean(variant.videoHash && movieHash && String(movieHash).toLowerCase() === String(variant.videoHash).toLowerCase());
  return {
    provider: 'opensubtitles',
    id: `os-${item.id || fileId || attr.subtitle_id}`,
    providerId: item.id || attr.subtitle_id || fileId,
    fileId,
    name: attr.release || attr.feature_details?.title || attr.filename || 'OpenSubtitles Arabic',
    releaseName: attr.release || attr.filename || firstFile.file_name || '',
    fileName: attr.filename || firstFile.file_name || '',
    lang: normalizeStremioLanguage(language),
    downloads: attr.download_count || attr.downloads || 0,
    rating: attr.ratings || attr.rating || 0,
    season: attr.feature_details?.season_number || attr.season_number || null,
    episode: attr.feature_details?.episode_number || attr.episode_number || null,
    imdbId: attr.feature_details?.imdb_id ? `tt${attr.feature_details.imdb_id}` : null,
    movieHash,
    matchedByHash,
    tmdbId: attr.feature_details?.tmdb_id || null,
    hearingImpaired: Boolean(attr.hearing_impaired),
    machineTranslated: Boolean(attr.machine_translated),
    automatedTranslated: Boolean(attr.ai_translated),
    trusted: Boolean(attr.from_trusted),
    download: fileId ? `/downloads/opensubtitles/${fileId}.srt` : attr.url || attr.download_url || null,
    raw: item,
  };
}

export async function searchOpenSubtitles(variant) {
  if (!config.openSubtitles.apiKey) return [];

  const params = new URLSearchParams();
  const expectedLanguage = isEnglishLanguage(variant.language) ? 'en' : 'ar';
  addParam(params, 'languages', providerLanguageParam(expectedLanguage, 'opensubtitles'));
  addParam(params, 'order_by', config.openSubtitles.orderBy);
  addParam(params, 'order_direction', config.openSubtitles.orderDirection);
  addParam(params, 'type', variant.type === 'series' ? 'episode' : 'movie');
  addParam(params, 'query', variant.query);
  addParam(params, 'imdb_id', cleanImdb(variant.imdbId));
  addParam(params, 'tmdb_id', variant.tmdbId);
  addParam(params, 'season_number', variant.season);
  addParam(params, 'episode_number', variant.episode);
  addParam(params, 'moviehash', variant.videoHash || variant.hash);
  addParam(params, 'moviebytesize', variant.videoSize);
  addParam(params, 'hearing_impaired', config.providers.excludeHearingImpaired ? 'exclude' : 'include');
  if (config.openSubtitles.trustedOnly) addParam(params, 'trusted_sources', 'only');

  const url = `${config.openSubtitles.baseUrl}/subtitles?${params.toString()}`;
  const json = await fetchJson(url, {
    headers: osHeaders(),
    signal: variant.signal,
    trustedOrigin: config.openSubtitles.baseUrl,
  });
  const data = Array.isArray(json?.data) ? json.data : [];
  return data.map(item => normalizeItem(item, expectedLanguage, variant)).filter(Boolean).slice(0, config.providers.maxProviderItems);
}

export async function getOpenSubtitlesDownloadLink(fileId) {
  if (!config.openSubtitles.apiKey) throw new Error('OPENSUBTITLES_API_KEY is missing');
  const json = await fetchJson(`${config.openSubtitles.baseUrl}/download`, {
    method: 'POST',
    headers: {
      ...osHeaders({ 'content-type': 'application/json' }),
    },
    body: JSON.stringify({ file_id: Number(fileId), sub_format: 'srt' }),
    timeoutMs: config.providers.timeoutMs,
    trustedOrigin: config.openSubtitles.baseUrl,
  });
  const link = json?.link || json?.url;
  if (!link) throw new Error('OpenSubtitles download link is missing');
  return link;
}
