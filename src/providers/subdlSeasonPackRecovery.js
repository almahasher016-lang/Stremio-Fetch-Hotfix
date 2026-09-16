import { config } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { buildSubdlParams, expandSubdlSubtitles } from './subdl.js';

const BLURAY_RE = /(?:^|[^a-z0-9])(?:blu[ ._-]?ray|bdremux|bdrip)(?:$|[^a-z0-9])/i;

function imdbId(value) {
  const match = String(value || '').match(/(?:tt)?(\d{5,12})/i);
  return match ? match[1] : null;
}

function allowedSubtitleDownload(value, downloadBaseUrl) {
  const raw = String(value || '').trim();
  if (/^\/subtitle\//i.test(raw) && !raw.startsWith('//')) return true;
  try {
    const origin = new URL(downloadBaseUrl).origin;
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password
      && url.origin === origin && /^\/subtitle\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function matchingEpisode(file, variant) {
  const season = Number(variant.season);
  const episode = Number(variant.episode);
  if (file.season != null && file.season !== '' && Number(file.season) !== season) return false;
  if (file.episode != null && file.episode !== '' && Number(file.episode) !== episode) return false;
  // Metadata on a season archive is not enough to identify one episode. If the
  // child omits either number, require an explicit episode identifier in its name.
  if (file.season == null || file.episode == null) {
    const name = String(file.name || file.file_name || file.filename || file.release_name || '');
    const pattern = new RegExp(`(?:^|[^a-z0-9])(?:s0*${season}e0*${episode}|0*${season}x0*${episode})(?:[^0-9]|$)`, 'i');
    if (!pattern.test(name)) return false;
  }
  return true;
}

/** Find individual episodes inside legitimate SubDL BluRay season archives.
 * A matching release family is a discovery hint, never timing verification.
 */
export async function searchSubdlBluRaySeasonPack(variant, {
  fetchJsonImpl = fetchJson,
  configImpl = config,
} = {}) {
  const season = Number(variant.season);
  const episode = Number(variant.episode);
  if (!configImpl.subdl?.apiKey || !configImpl.providers?.searchFullSeason
      || variant.type !== 'series' || variant.reason !== 'coverage-source-family'
      || !BLURAY_RE.test(String(variant.query || ''))
      || !Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1
      || (!variant.imdbId && !variant.tmdbId)) return [];

  const mode = variant.imdbId ? 'imdb' : 'tmdb';
  const params = buildSubdlParams(variant, 'ar', mode, configImpl);
  // The ordinary episode lookup remains intact. This independent query allows
  // archive-level results, which an episode_number constraint may exclude.
  params.delete('episode_number');
  params.set('full_season', '1');
  params.set('unpack', '1');
  const payload = await fetchJsonImpl(`${configImpl.subdl.baseUrl}?${params.toString()}`, {
    signal: variant.signal,
    trustedOrigin: configImpl.subdl.baseUrl,
  });
  if (payload?.status === false || payload?.error) return [];
  const catalogs = Array.isArray(payload?.results) ? payload.results : [];
  const expectedImdb = imdbId(variant.imdbId);
  if (expectedImdb && catalogs.some(item => imdbId(item.imdb_id) && imdbId(item.imdb_id) !== expectedImdb)) return [];
  if (catalogs.some(item => item.type && !['tv', 'series', 'episode'].includes(String(item.type).toLowerCase()))) return [];

  const rows = Array.isArray(payload?.subtitles) ? payload.subtitles : [];
  const candidates = [];
  const seen = new Set();
  for (const row of rows) {
    const release = String(row.release_name || row.filename || row.name || '');
    if (!BLURAY_RE.test(release) || !Array.isArray(row.unpack_files) || !row.unpack_files.length) continue;
    if (expectedImdb && imdbId(row.imdb_id) && imdbId(row.imdb_id) !== expectedImdb) continue;
    if (row.season != null && Number(row.season) !== season) continue;
    if (row.lang || row.language || row.language_code || row.language_name) {
      const language = String(row.lang || row.language || row.language_code || row.language_name).toLowerCase();
      if (!['ar', 'ara', 'arabic'].includes(language)) continue;
    }
    const files = row.unpack_files.filter(file => matchingEpisode(file, variant)
      && allowedSubtitleDownload(file.url || file.download_link, configImpl.subdl.downloadBaseUrl));
    if (!files.length) continue;
    const matchingRows = [{
      ...row,
      imdb_id: row.imdb_id || catalogs[0]?.imdb_id || variant.imdbId || null,
      unpack_files: files.map(file => ({
        ...file,
        url: file.url || file.download_link,
        release_name: file.release_name || release,
        language: file.lang || file.language || row.lang || row.language || 'ar',
        season,
        episode,
      })),
    }];
    for (const candidate of expandSubdlSubtitles(matchingRows, 'ar', variant, configImpl)) {
      const key = String(candidate.md5 || candidate.download || candidate.id || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // No guessed hash, no reference, and no inferred timing evidence.
      candidate.matchedByHash = false;
      candidate.season = season;
      candidate.episode = episode;
      candidates.push(candidate);
      if (candidates.length >= configImpl.providers.maxProviderItems) return candidates;
    }
  }
  return candidates;
}
