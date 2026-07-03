import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage, providerLanguageParam } from '../utils/language.js';

function addParam(params, key, value) {
  if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
}

function cleanImdb(value) {
  if (!value) return null;
  const match = String(value).match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : String(value).replace(/[^0-9]/g, '') || null;
}

function normalizeUrl(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${config.subdl.downloadBaseUrl}${raw}`;
  return `${config.subdl.downloadBaseUrl}/${raw}`;
}

function sanitizeForSubdl(value, { maxLength = 180 } = {}) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/[\[\](){},+&]/g, ' ')
    .replace(/[^A-Za-z0-9\u0600-\u06FF ._:\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function titleFromRelease(value) {
  let cleaned = sanitizeForSubdl(value, { maxLength: 180 }).replace(/[._-]+/g, ' ');
  const cut = cleaned.search(/\b(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|4320p|2160p|1080p|720p|480p|4k|UHD|WEB|WEBRip|WEB DL|BluRay|REMUX|HDR|DV|HEVC|AVC|x264|x265|H264|H265|19\d{2}|20\d{2})\b/i);
  if (cut > 2) cleaned = cleaned.slice(0, cut);
  return cleaned.replace(/\s+/g, ' ').trim();
}

function normalizeItem(item, expectedLanguage = 'ar') {
  const language = item.lang || item.language || item.language_code || item.language_name || (expectedLanguage === 'en' ? 'en' : 'ar');
  const isExpected = expectedLanguage === 'en' ? isEnglishLanguage(language) : isArabicLanguage(language);
  if (!isExpected) return null;
  const download = normalizeUrl(item.url || item.download_link || item.file || item.path);
  return {
    provider: 'subdl',
    id: `subdl-${item.id || item.subtitle_id || item.file_n_id || item.url || item.download_link}`,
    providerId: item.id || item.subtitle_id || item.file_n_id || null,
    name: item.release_name || item.name || item.filename || 'SubDL Arabic',
    releaseName: item.release_name || item.filename || item.name || '',
    fileName: item.filename || item.file_name || item.name || '',
    lang: normalizeStremioLanguage(language),
    downloads: item.downloads || item.download_count || 0,
    rating: item.rating || 0,
    season: item.season || item.season_number || null,
    episode: item.episode || item.episode_number || null,
    fps: item.fps || null,
    imdbId: item.imdb_id || null,
    tmdbId: item.tmdb_id || null,
    hearingImpaired: Boolean(item.hearing_impaired || item.hi || item.sdh),
    machineTranslated: Boolean(item.machine_translated || item.auto_translated),
    download,
    raw: item,
  };
}

function expandSubtitles(rows, expectedLanguage) {
  const output = [];
  for (const item of rows || []) {
    if (Array.isArray(item.unpack_files) && item.unpack_files.length) {
      for (const file of item.unpack_files) {
        output.push(normalizeItem({ ...item, ...file, url: file.url || item.url }, expectedLanguage));
      }
    } else {
      output.push(normalizeItem(item, expectedLanguage));
    }
  }
  return output.filter(Boolean);
}

async function requestSubdl(params) {
  const json = await fetchJson(`${config.subdl.baseUrl}?${params.toString()}`);
  if (json && json.status === false) {
    const err = new Error(`SubDL: ${json.error || 'API returned status=false'}`);
    err.statusCode = 400;
    throw err;
  }
  return json;
}

function buildParams(variant, expectedLanguage, mode = 'full') {
  const params = new URLSearchParams();
  addParam(params, 'api_key', config.subdl.apiKey);
  addParam(params, 'languages', providerLanguageParam(expectedLanguage, 'subdl'));
  addParam(params, 'type', variant.type === 'series' ? 'tv' : 'movie');
  addParam(params, 'subs_per_page', 30);
  addParam(params, 'releases', 1);
  addParam(params, 'hi', 1);

  if (mode === 'imdb' && variant.imdbId) addParam(params, 'imdb_id', cleanImdb(variant.imdbId));
  else if (mode === 'tmdb' && variant.tmdbId) addParam(params, 'tmdb_id', variant.tmdbId);
  else if (mode === 'file' && variant.filename) {
    const safeFileName = sanitizeForSubdl(variant.filename, { maxLength: 200 });
    if (safeFileName) addParam(params, 'file_name', safeFileName);
    else addParam(params, 'film_name', titleFromRelease(variant.query || variant.filename || variant.imdbId || variant.tmdbId));
  } else {
    addParam(params, 'film_name', titleFromRelease(variant.query || variant.filename || variant.imdbId || variant.tmdbId));
  }

  addParam(params, 'year', variant.year);
  addParam(params, 'season_number', variant.season);
  addParam(params, 'episode_number', variant.episode);

  if (variant.type === 'series' && config.providers.searchFullSeason) {
    addParam(params, 'full_season', 1);
    addParam(params, 'unpack', 1);
  }
  return params;
}

export async function searchSubdl(variant) {
  if (!config.subdl.apiKey) return [];
  const expectedLanguage = isEnglishLanguage(variant.language) ? 'en' : 'ar';
  const modes = [];
  if (variant.imdbId) modes.push('imdb');
  if (variant.tmdbId) modes.push('tmdb');
  if (variant.filename) modes.push('file');
  modes.push('query');

  const all = [];
  const seen = new Set();
  for (const mode of modes) {
    try {
      const json = await requestSubdl(buildParams(variant, expectedLanguage, mode));
      const rows = Array.isArray(json?.subtitles) ? json.subtitles : Array.isArray(json?.results) ? json.results : [];
      for (const item of expandSubtitles(rows, expectedLanguage)) {
        const key = item.download || item.releaseName || item.id;
        if (key && !seen.has(key)) {
          seen.add(key);
          all.push(item);
        }
      }
      if (all.length) break;
    } catch (err) {
      // Try the next search shape. The outer service will log only if all shapes fail.
      if (mode === modes[modes.length - 1]) throw err;
    }
  }
  return all.slice(0, config.providers.maxProviderItems);
}
