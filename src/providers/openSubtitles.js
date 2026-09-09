import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage, providerLanguageParam } from '../utils/language.js';

const MAX_SEARCH_PAGES = 5;

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

function responseTotalPages(payload = {}, currentPage = 1) {
  const raw = payload.total_pages
    ?? payload.totalPages
    ?? payload.pagination?.total_pages
    ?? payload.pagination?.totalPages
    ?? payload.meta?.total_pages
    ?? payload.meta?.totalPages
    ?? currentPage;
  const total = Number(raw);
  if (!Number.isFinite(total) || total < 1) return currentPage;
  return Math.max(currentPage, Math.floor(total));
}

function candidateKey(item = {}) {
  return String(item.fileId || item.providerId || item.id || item.download || '');
}

export function normalizeOpenSubtitlesItem(item, expectedLanguage = 'ar', variant = {}) {
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
  const feature = attr.feature_details || {};
  const isEpisode = String(feature.feature_type).toLowerCase() === 'episode';
  // Episode catalog IDs identify the episode, while Stremio searches use the series ID.
  const imdbId = feature.parent_imdb_id || (!isEpisode ? feature.imdb_id : null);
  const tmdbId = feature.parent_tmdb_id || (!isEpisode ? feature.tmdb_id : null);
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
    season: attr.feature_details?.season_number ?? attr.season_number ?? null,
    episode: attr.feature_details?.episode_number ?? attr.episode_number ?? null,
    type: attr.feature_details?.feature_type || null,
    imdbId: imdbId ? `tt${cleanImdb(imdbId)}` : null,
    movieHash,
    matchedByHash,
    tmdbId: tmdbId || null,
    fps: attr.fps || null,
    hearingImpaired: Boolean(attr.hearing_impaired),
    machineTranslated: Boolean(attr.machine_translated),
    automatedTranslated: Boolean(attr.ai_translated),
    trusted: Boolean(attr.from_trusted),
    download: fileId ? `/downloads/opensubtitles/${fileId}.srt` : attr.url || attr.download_url || null,
    raw: item,
  };
}

export function buildOpenSubtitlesRequest(variant, { page = 1 } = {}) {
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
  addParam(params, 'page', Math.max(1, Math.floor(Number(page) || 1)));
  addParam(
    params,
    'hearing_impaired',
    variant.relaxedFallback ? 'include' : (config.providers.excludeHearingImpaired ? 'exclude' : 'include'),
  );
  if (config.openSubtitles.trustedOnly) addParam(params, 'trusted_sources', 'only');

  return {
    url: `${config.openSubtitles.baseUrl}/subtitles?${params.toString()}`,
    headers: osHeaders(),
    expectedLanguage,
  };
}

export function parseOpenSubtitlesResponse(payload, expectedLanguage = 'ar', variant = {}) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map(item => normalizeOpenSubtitlesItem(item, expectedLanguage, variant))
    .filter(Boolean)
    .slice(0, config.providers.maxProviderItems);
}

export async function searchOpenSubtitles(variant, { fetchJsonImpl = fetchJson } = {}) {
  if (!config.openSubtitles.apiKey) return [];
  const maxItems = Math.max(1, Number(config.providers.maxProviderItems) || 1);
  const output = [];
  const seen = new Set();
  let page = 1;
  let totalPages = 1;

  do {
    const request = buildOpenSubtitlesRequest(variant, { page });
    const json = await fetchJsonImpl(request.url, {
      headers: request.headers,
      signal: variant.signal,
      trustedOrigin: config.openSubtitles.baseUrl,
    });
    totalPages = Math.min(MAX_SEARCH_PAGES, responseTotalPages(json, page));
    for (const item of parseOpenSubtitlesResponse(json, request.expectedLanguage, variant)) {
      const key = candidateKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
      if (output.length >= maxItems) break;
    }
    page += 1;
  } while (output.length < maxItems && page <= totalPages && page <= MAX_SEARCH_PAGES);

  return output.slice(0, maxItems);
}

export function buildOpenSubtitlesDownloadBody(fileId, { subFormat = 'srt' } = {}) {
  const body = { file_id: Number(fileId) };
  const normalizedFormat = subFormat === null || subFormat === ''
    ? null
    : String(subFormat).trim().toLowerCase();
  if (normalizedFormat) body.sub_format = normalizedFormat;
  return body;
}

export async function getOpenSubtitlesDownloadLink(fileId, options = {}) {
  if (!config.openSubtitles.apiKey) throw new Error('OPENSUBTITLES_API_KEY is missing');
  const body = buildOpenSubtitlesDownloadBody(fileId, options);
  const json = await fetchJson(`${config.openSubtitles.baseUrl}/download`, {
    method: 'POST',
    headers: {
      ...osHeaders({ 'content-type': 'application/json' }),
    },
    body: JSON.stringify(body),
    timeoutMs: config.providers.timeoutMs,
    trustedOrigin: config.openSubtitles.baseUrl,
  });
  const link = json?.link || json?.url;
  if (!link) throw new Error('OpenSubtitles download link is missing');
  return link;
}
