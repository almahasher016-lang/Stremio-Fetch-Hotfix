import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage } from '../utils/language.js';
import { parseRelease } from '../utils/releaseParser.js';

const SERIES_EPISODE_BOUNDARY_RE = /\b(?:s\d{1,3}e\d{1,4}|\d{1,3}x\d{1,4})\b/i;
const TITLE_STOPWORDS = new Set(['a', 'an', 'and', 'of', 'the', 'to']);

function cleanImdb(value) {
  const match = String(value || '').match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function trustedDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'strem.io' && !host.endsWith('.strem.io')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function requestId(variant = {}) {
  const imdbId = cleanImdb(variant.imdbId || variant.id || variant.catalogId);
  if (!imdbId) return null;
  if (variant.type !== 'series') return imdbId;
  const season = positiveInteger(variant.season);
  const episode = positiveInteger(variant.episode);
  return season && episode ? `${imdbId}:${season}:${episode}` : null;
}

function titleTokens(value, { seriesRelease = false } = {}) {
  let text = String(value || '').normalize('NFKC');
  if (seriesRelease) {
    const boundary = text.search(SERIES_EPISODE_BOUNDARY_RE);
    if (boundary <= 0) return [];
    text = text.slice(0, boundary);
  }
  return [...new Set(text
    .toLowerCase()
    .replace(/[._:+/\\()[\]{}-]+/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 1 && !TITLE_STOPWORDS.has(token)))];
}

function clearlyWrongSeriesTitle(releaseName, variant = {}, explicitImdbId = null) {
  if (variant.type !== 'series' || explicitImdbId) return false;
  const candidate = titleTokens(releaseName, { seriesRelease: true });
  if (candidate.length < 2) return false;

  const requestedTitles = [variant.title, variant.query, ...(variant.aliases || [])]
    .map(value => titleTokens(value))
    .filter(tokens => tokens.length > 0);
  if (!requestedTitles.length) return false;

  return requestedTitles.every(target => !candidate.some(token => target.includes(token)));
}

export function normalizeStremioOpenSubtitlesItem(item, variant = {}) {
  const expectedLanguage = isEnglishLanguage(variant.language) ? 'en' : 'ar';
  const language = item?.lang || item?.language || '';
  const expected = expectedLanguage === 'en' ? isEnglishLanguage(language) : isArabicLanguage(language);
  const download = trustedDownloadUrl(item?.url);
  if (!expected || !download) return null;

  const providerId = String(item.id || item.fileId || item.file_id || '').trim();
  if (!providerId) return null;
  const fileName = String(item.subtitleFileName || item.fileName || '').trim();
  const releaseName = String(item.movieReleaseName || item.releaseName || fileName).trim();
  const explicitImdbId = cleanImdb(item.imdbId || item.imdb_id);
  if (clearlyWrongSeriesTitle(releaseName || fileName, variant, explicitImdbId)) return null;

  const releaseIdentity = parseRelease(releaseName || fileName);
  const fpsMilli = Number(item.fpsMilli);
  const requestedImdbId = cleanImdb(variant.imdbId || variant.id || variant.catalogId);
  const requestedSeason = variant.type === 'series' ? positiveInteger(variant.season) : null;
  const requestedEpisode = variant.type === 'series' ? positiveInteger(variant.episode) : null;

  return {
    provider: 'stremio',
    id: `stremio-osv3-${providerId}`,
    providerId,
    name: releaseName || fileName || 'Stremio OpenSubtitles',
    releaseName,
    fileName,
    lang: normalizeStremioLanguage(language),
    // Never manufacture work/episode identity from the query. Some provider rows can be polluted
    // or neighboring results. Only identity explicitly returned by the row or encoded in its own
    // release name belongs on the candidate.
    imdbId: explicitImdbId,
    season: variant.type === 'series' ? positiveInteger(item.season) || releaseIdentity.season : null,
    episode: variant.type === 'series' ? positiveInteger(item.episode) || releaseIdentity.episode : null,
    // Query provenance remains available for diagnostics and proof logic, but is not candidate identity.
    searchCatalogId: requestedImdbId,
    searchSeason: requestedSeason,
    searchEpisode: requestedEpisode,
    type: variant.type === 'series' ? 'series' : 'movie',
    fps: Number.isFinite(fpsMilli) && fpsMilli > 0 ? fpsMilli / 1000 : null,
    hearingImpaired: /(?:^|[. _\-[\]()])(?:sdh|hi)(?:$|[. _\-[\]()])/i.test(`${fileName} ${releaseName}`),
    machineTranslated: null,
    trusted: false,
    download,
    sourceType: 'stremio-opensubtitles-v3',
    raw: item,
  };
}

export async function searchStremioOpenSubtitles(variant, {
  fetchJsonImpl = fetchJson,
  configImpl = config,
} = {}) {
  if (!configImpl.stremioOpenSubtitles?.enabled) return [];
  const id = requestId(variant);
  if (!id) return [];
  const type = variant.type === 'series' ? 'series' : 'movie';
  const url = `${configImpl.stremioOpenSubtitles.baseUrl}/subtitles/${type}/${encodeURIComponent(id)}.json`;
  const json = await fetchJsonImpl(url, {
    signal: variant.signal,
    trustedOrigin: configImpl.stremioOpenSubtitles.baseUrl,
  });
  const rows = Array.isArray(json?.subtitles) ? json.subtitles : [];
  const maxItems = Math.max(1, Number(configImpl.providers.maxProviderItems) || 1);
  return rows
    .map(item => normalizeStremioOpenSubtitlesItem(item, variant))
    .filter(Boolean)
    .slice(0, maxItems);
}
