import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage, providerLanguageParam } from '../utils/language.js';

function subsourceHeaders() {
  const headers = {};
  if (config.subsource.apiKey) headers['X-API-Key'] = config.subsource.apiKey;
  return headers;
}

function rowsFrom(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  return [];
}

function movieIdOf(item) {
  return item?.id || item?.movieId || item?.movie_id || item?.subsource_id || null;
}

function normalizeItem(item, expectedLanguage = 'ar') {
  const language = item.language || item.lang || item.language_code || (expectedLanguage === 'en' ? 'english' : 'arabic');
  const isExpected = expectedLanguage === 'en' ? isEnglishLanguage(language) : isArabicLanguage(language);
  if (!isExpected) return null;
  const id = item.subtitleId || item.subtitle_id || item.id || item.release_id;
  const releaseInfo = Array.isArray(item.releaseInfo) ? item.releaseInfo.join(' / ') : item.releaseInfo;
  return {
    provider: 'subsource',
    id: `subsource-${id || item.url || item.download}`,
    providerId: id,
    name: releaseInfo || item.release || item.name || item.title || 'SubSource Arabic',
    releaseName: releaseInfo || item.release || item.file_name || item.name || '',
    fileName: item.file_name || item.filename || '',
    lang: normalizeStremioLanguage(language),
    downloads: item.downloads || item.download_count || 0,
    rating: item.rating?.total || item.rating || 0,
    season: item.season || item.season_number || null,
    episode: item.episode || item.episode_number || null,
    imdbId: item.imdb_id || null,
    tmdbId: item.tmdb_id || null,
    hearingImpaired: Boolean(item.hearingImpaired || item.hearing_impaired || item.sdh),
    machineTranslated: Boolean(item.machine_translated || item.auto_translated),
    download: item.download || item.download_url || item.url || item.link || (id ? `/downloads/subsource/${id}` : null),
    raw: item,
  };
}

async function findMovieIds(variant) {
  const ids = [];
  const seen = new Set();

  async function addFrom(url) {
    const json = await fetchJson(url, { headers: subsourceHeaders() });
    for (const item of rowsFrom(json)) {
      const id = movieIdOf(item);
      if (id && !seen.has(String(id))) {
        seen.add(String(id));
        ids.push(id);
      }
    }
  }

  if (variant.query) {
    const params = new URLSearchParams();
    params.set('query', variant.query);
    if (variant.type) params.set('type', variant.type === 'series' ? 'tv' : 'movie');
    await addFrom(`${config.subsource.baseUrl}/movies/search?${params.toString()}`);
  }

  return ids.slice(0, 3);
}

export async function searchSubsource(variant) {
  if (!config.subsource.apiKey) return [];
  const expectedLanguage = isEnglishLanguage(variant.language) ? 'en' : 'ar';
  const language = providerLanguageParam(expectedLanguage, 'subsource');

  const movieIds = await findMovieIds(variant);
  const all = [];
  const seen = new Set();

  for (const movieId of movieIds) {
    const params = new URLSearchParams();
    params.set('movieId', String(movieId));
    params.set('language', language);
    params.set('limit', '30');
    if (variant.season) params.set('season', String(variant.season));
    if (variant.episode) params.set('episode', String(variant.episode));
    const json = await fetchJson(`${config.subsource.baseUrl}/subtitles?${params.toString()}`, { headers: subsourceHeaders() });
    for (const item of rowsFrom(json).map(row => normalizeItem(row, expectedLanguage)).filter(Boolean)) {
      const key = item.download || item.releaseName || item.id;
      if (key && !seen.has(key)) {
        seen.add(key);
        all.push(item);
      }
    }
  }

  return all.slice(0, config.providers.maxProviderItems);
}

export async function getSubsourceDownloadLink(subtitleId) {
  const json = await fetchJson(`${config.subsource.baseUrl}/subtitles/${encodeURIComponent(subtitleId)}/download`, {
    headers: subsourceHeaders(),
  });
  const link = json?.download || json?.download_url || json?.url || json?.link || json?.data?.download || json?.data?.url;
  if (!link) throw new Error('SubSource download link is missing');
  return link;
}
