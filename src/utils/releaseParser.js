const QUALITY_RE = /\b(4320p|2160p|4k|uhd|1080p|720p|480p|hdrip|brrip|dvdrip)\b/i;
const SOURCE_RE = /\b(web[- .]?dl|webrip|web|bluray|blu[- .]?ray|bdrip|hdtv|hdcam|cam|dvdrip|remux)\b/i;
const CODEC_RE = /\b(x264|x265|h\.264|h\.265|hevc|avc|av1|10bit|8bit)\b/i;
const HDR_RE = /\b(dolby[ .-]?vision|dv|hdr10\+?|hdr|sdr)\b/i;
const AUDIO_RE = /\b(atmos|truehd|dts[- .]?hd|dts|aac|eac3|ddp?5\.1|5\.1|7\.1)\b/i;
const SE_RE = /\bS(\d{1,2})E(\d{1,3})\b/i;
const ALT_SE_RE = /\b(\d{1,2})x(\d{1,3})\b/;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const FPS_RE = /\b(23[.,]976|23[.,]98|24|25|29[.,]97|30|50|60)\s?fps\b/i;

function cleanToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(pattern, value) {
  const match = String(value || '').match(pattern);
  return match ? match[1] || match[0] : null;
}

function normalizeSource(value) {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/[ .]/g, '-');
  if (lower.includes('web')) return 'web-dl';
  if (lower.includes('blu')) return 'bluray';
  if (lower.includes('hdtv')) return 'hdtv';
  if (lower.includes('remux')) return 'remux';
  return lower;
}

function normalizeQuality(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === '4k' || lower === 'uhd') return '2160p';
  return lower;
}

function parseSeasonEpisode(value) {
  const str = String(value || '');
  let match = str.match(SE_RE);
  if (!match) match = str.match(ALT_SE_RE);
  if (!match) return { season: null, episode: null };
  return { season: Number.parseInt(match[1], 10), episode: Number.parseInt(match[2], 10) };
}

function parseReleaseGroup(value) {
  const str = String(value || '');
  const dashMatch = str.match(/-([A-Za-z0-9]{2,12})(?:\.[A-Za-z0-9]{2,4})?$/);
  if (dashMatch) return dashMatch[1].toUpperCase();
  const bracketMatch = str.match(/\[([A-Za-z0-9]{2,12})]/);
  return bracketMatch ? bracketMatch[1].toUpperCase() : null;
}

export function parseRelease(value = '') {
  const text = String(value || '');
  const se = parseSeasonEpisode(text);
  const year = firstMatch(YEAR_RE, text);
  const fps = firstMatch(FPS_RE, text);
  return {
    raw: text,
    normalized: cleanToken(text),
    tokens: new Set(cleanToken(text).split(' ').filter(Boolean)),
    quality: normalizeQuality(firstMatch(QUALITY_RE, text)),
    source: normalizeSource(firstMatch(SOURCE_RE, text)),
    codec: firstMatch(CODEC_RE, text)?.toLowerCase() || null,
    hdr: firstMatch(HDR_RE, text)?.toLowerCase() || null,
    audio: firstMatch(AUDIO_RE, text)?.toLowerCase() || null,
    year: year ? Number.parseInt(year, 10) : null,
    season: se.season,
    episode: se.episode,
    fps: fps ? Number.parseFloat(String(fps).replace(',', '.')) : null,
    releaseGroup: parseReleaseGroup(text),
  };
}

export function tokenOverlapScore(left, right) {
  const a = left instanceof Set ? left : parseRelease(left).tokens;
  const b = right instanceof Set ? right : parseRelease(right).tokens;
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) {
    if (token.length > 1 && b.has(token)) overlap++;
  }
  return overlap / Math.max(a.size, b.size);
}


export function stableFingerprint(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function buildSearchVariants({ query, imdbId, tmdbId, season, episode, filename, type, year, videoHash, videoSize }) {
  const variants = [];
  const seen = new Set();
  function add(reason, payload) {
    const compact = JSON.stringify(payload);
    if (seen.has(compact)) return;
    seen.add(compact);
    variants.push({ reason, ...payload });
  }

  // Hash-first path: when Stremio sends videoHash/videoSize, OpenSubtitles can often return the exact subtitle.
  if (videoHash) add('hash-first', { query: filename || query, imdbId, tmdbId, season, episode, filename, type, year, videoHash, videoSize });
  if (imdbId || tmdbId || filename) add('exact-id-file', { query, imdbId, tmdbId, season, episode, filename, type, year });
  if (imdbId || tmdbId) add('exact-id', { query, imdbId, tmdbId, season, episode, type, year });
  if (filename) add('file-name', { query: filename, filename, season, episode, type, year });
  if (query) add('query-season-episode', { query, season, episode, type, year });
  if (query && type === 'movie') add('query-year', { query, year, type });

  return variants;
}
