import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { isArabicLanguage, isEnglishLanguage, normalizeStremioLanguage } from '../utils/language.js';
import { stableFingerprint } from '../utils/releaseParser.js';

const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'is',
  'season', 'saison', 'episode', 'ep', 'el', 'la', 'le', 'les', 'de', 'du', 'des', 'un', 'une',
]);
const TITLE_BOUNDARY_RE = /^(?:s\d{1,2}(?:e\d{1,3})?|e\d{1,3}|\d{1,2}x\d{1,3}|19\d{2}|20\d{2}|4320p|2160p|1080[pi]?|720[pi]?|576[pi]?|480[pi]?|8k|4k|uhd|web|webdl|webrip|hdtv|bluray|brrip|bdrip|remux|dvdrip|x264|x265|h264|h265|hevc|avc|av1|vp9|hdr|hdr10|dovi|dv)$/i;

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

function significantTitleTokens(value) {
  const tokens = stableFingerprint(value).split(' ').filter(Boolean);
  const output = [];
  for (const token of tokens) {
    if (TITLE_BOUNDARY_RE.test(token)) break;
    if (token.length < 2 || TITLE_STOP_WORDS.has(token)) continue;
    output.push(token);
    if (output.length >= 8) break;
  }
  return output;
}

function titleScript(tokens = []) {
  const text = tokens.join('');
  const arabic = /[\u0600-\u06ff]/.test(text);
  const latin = /[a-z]/i.test(text);
  if (arabic && !latin) return 'arabic';
  if (latin && !arabic) return 'latin';
  return 'mixed';
}

export function hasStrongStremioTitleConflict(item = {}, variant = {}) {
  // The Stremio OpenSubtitles endpoint is queried by catalog id, but individual rows can still
  // occasionally contain a release name for another work. Do not trust the request id alone when
  // the provider itself gives us a clear, multi-token catalog release title that contradicts it.
  const catalogReleaseName = String(item.movieReleaseName || item.releaseName || '').trim();
  if (!catalogReleaseName) return false;
  const candidateTokens = significantTitleTokens(catalogReleaseName);
  if (candidateTokens.length < 2) return false;

  const candidateScript = titleScript(candidateTokens);
  const targetNames = [
    variant.title,
    ...(Array.isArray(variant.aliases) ? variant.aliases : []),
  ];
  const targets = targetNames
    .map(significantTitleTokens)
    .filter(tokens => tokens.length >= 2 && titleScript(tokens) === candidateScript);
  if (!targets.length) return false;

  const candidateSet = new Set(candidateTokens);
  return targets.every(tokens => !tokens.some(token => candidateSet.has(token)));
}

export function normalizeStremioOpenSubtitlesItem(item, variant = {}) {
  const expectedLanguage = isEnglishLanguage(variant.language) ? 'en' : 'ar';
  const language = item?.lang || item?.language || '';
  const expected = expectedLanguage === 'en' ? isEnglishLanguage(language) : isArabicLanguage(language);
  const download = trustedDownloadUrl(item?.url);
  if (!expected || !download || hasStrongStremioTitleConflict(item, variant)) return null;

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
