import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage } from '../utils/language.js';

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
  const fpsMilli = Number(item.fpsMilli);
  return {
    provider: 'stremio',
    id: `stremio-osv3-${providerId}`,
    providerId,
    name: releaseName || fileName || 'Stremio OpenSubtitles',
    releaseName,
    fileName,
    lang: normalizeStremioLanguage(language),
    imdbId: cleanImdb(variant.imdbId || variant.id || variant.catalogId),
    season: variant.type === 'series' ? positiveInteger(item.season) || positiveInteger(variant.season) : null,
    episode: variant.type === 'series' ? positiveInteger(item.episode) || positiveInteger(variant.episode) : null,
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
