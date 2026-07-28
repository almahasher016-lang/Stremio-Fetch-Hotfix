const QUALITY_RE = /\b(4320p|8k|2160p|4k|uhd|1080[pi]|720[pi]|576[pi]|480[pi])\b/i;
const SOURCE_RE = /\b(web[- .]?dl|web[- .]?rip|web|blu[- .]?ray|b[rd]rip|hdtv|hdcam|telesync|telecine|cam|dvd[- .]?rip|hd[- .]?rip|remux)\b/i;
const CODEC_RE = /\b(x264|x265|h[ .]?264|h[ .]?265|hevc|avc|av1|vp9)\b/i;
const BIT_DEPTH_RE = /\b(8|10|12)[- .]?bit\b/i;
const HDR_RE = /\b(dolby[ .-]?vision|dv|hdr10\+?|hdr|sdr)\b/i;
const AUDIO_RE = /\b(truehd|dts[- .]?(?:hd|x)|dts|e[- .]?ac[- .]?3|ddp|dd\+|ac[- .]?3|aac|flac|opus|mp3)(?![a-z])/i;
const AUDIO_PROFILE_RE = /\b(atmos)\b/i;
const CHANNEL_RE = /(?:^|[^\d])(1[ .]0|2[ .]0|5[ .]?1|7[ .]?1)(?!\d|[- .]?bit)/i;
const SERVICE_RE = /\b(amzn|amazon|nf|netflix|dsnp|disney\+?|atvp|apple[- .]?tv\+?|hmax|hbo[- .]?max|max|hulu|pmtp|paramount\+?|pcok|peacock|crav|stan)\b/i;
const SE_RE = /\bS(\d{1,2})E(\d{1,3})\b/i;
const ALT_SE_RE = /\b(\d{1,2})x(\d{1,3})\b/;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const FPS_RE = /\b(23[.,]976|23[.,]98|24|25|29[.,]97|30|50|60)\s?fps\b/i;
const EDITION_PATTERNS = [
  ['directors-cut', /\bdirector(?:'s|s)?[- ._]+(?:cut|edition)\b/i],
  ['extended', /\bextended(?:[- ._]+(?:cut|edition|version))?\b/i],
  ['theatrical', /\btheatrical(?:[- ._]+(?:cut|edition|version))?\b/i],
  ['unrated', /\bunrated(?:[- ._]+(?:cut|edition|version))?\b/i],
  ['imax', /\bimax(?:[- ._]+(?:cut|edition|version))?\b/i],
  ['remastered', /\b(?:re[- ._]?master(?:ed)?|remastered)(?:[- ._]+edition)?\b/i],
];

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
  if (lower.includes('webrip') || lower.includes('web-rip')) return 'webrip';
  if (lower === 'web') return 'web';
  if (lower.includes('web')) return 'web-dl';
  if (lower === 'brrip' || lower === 'bdrip') return 'bluray-rip';
  if (lower.includes('blu')) return 'bluray';
  if (lower.includes('hdtv')) return 'hdtv';
  if (lower.includes('remux')) return 'remux';
  if (lower.includes('dvd')) return 'dvdrip';
  if (lower.includes('hd-rip') || lower === 'hdrip') return 'hdrip';
  if (lower.includes('telesync')) return 'telesync';
  if (lower.includes('telecine')) return 'telecine';
  if (lower.includes('cam')) return 'cam';
  return lower;
}

function parseSource(value) {
  const text = String(value || '');
  if (/\bremux\b/i.test(text)) return 'remux';
  return normalizeSource(firstMatch(SOURCE_RE, text));
}

function normalizeQuality(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === '8k') return '4320p';
  if (lower === '4k' || lower === 'uhd') return '2160p';
  return lower;
}

function normalizeCodec(value) {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/[ .]/g, '');
  if (['x264', 'h264', 'avc'].includes(lower)) return 'h264';
  if (['x265', 'h265', 'hevc'].includes(lower)) return 'hevc';
  return lower;
}

function normalizeHdr(value) {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/[ ._-]/g, '');
  if (lower === 'dv' || lower === 'dolbyvision') return 'dolby-vision';
  if (lower === 'hdr10+') return 'hdr10+';
  if (lower === 'hdr10') return 'hdr10';
  return lower;
}

function normalizeAudio(value) {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/[ ._-]/g, '');
  if (['eac3', 'ddp', 'dd+'].includes(lower)) return 'eac3';
  if (lower === 'ac3') return 'ac3';
  if (lower === 'dtshd') return 'dts-hd';
  if (lower === 'dtsx') return 'dts-x';
  return lower;
}

function normalizeChannels(value) {
  if (!value) return null;
  return value.replace(/[ ]/g, '.');
}

function normalizeService(value) {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/[ ._-]/g, '');
  if (lower === 'amazon' || lower === 'amzn') return 'amazon';
  if (lower === 'nf' || lower === 'netflix') return 'netflix';
  if (lower.startsWith('disney') || lower === 'dsnp') return 'disney-plus';
  if (lower.startsWith('apple') || lower === 'atvp') return 'apple-tv-plus';
  if (['hmax', 'hbomax', 'max'].includes(lower)) return 'max';
  if (lower.startsWith('paramount') || lower === 'pmtp') return 'paramount-plus';
  if (lower === 'pcok' || lower === 'peacock') return 'peacock';
  if (lower === 'crav') return 'crave';
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
  const str = String(value || '')
    .replace(/\.(?:mkv|mp4|avi|m4v|mov|srt|ass|ssa|vtt)$/i, '')
    .replace(/(?:\.(?:ar|ara|arabic|en|eng|forced|sdh|hi))+$/i, '');
  const dashMatch = str.match(/-([A-Za-z0-9][A-Za-z0-9._]{1,31})$/);
  if (dashMatch) return dashMatch[1].replace(/[._]+$/g, '').toUpperCase();
  const bracketMatch = str.match(/\[([A-Za-z0-9][A-Za-z0-9._-]{1,31})]/);
  return bracketMatch ? bracketMatch[1].toUpperCase() : null;
}

function parseEditions(value) {
  const text = String(value || '');
  return EDITION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([edition]) => edition);
}

export function parseRelease(value = '') {
  const text = String(value || '');
  const se = parseSeasonEpisode(text);
  const year = firstMatch(YEAR_RE, text);
  const fps = firstMatch(FPS_RE, text);
  const codec = firstMatch(CODEC_RE, text);
  const audio = firstMatch(AUDIO_RE, text);
  const editions = parseEditions(text);
  return {
    raw: text,
    normalized: cleanToken(text),
    tokens: new Set(cleanToken(text).split(' ').filter(Boolean)),
    quality: normalizeQuality(firstMatch(QUALITY_RE, text)),
    source: parseSource(text),
    codec: codec?.toLowerCase() || null,
    codecFamily: normalizeCodec(codec),
    bitDepth: firstMatch(BIT_DEPTH_RE, text)?.toLowerCase() || null,
    hdr: normalizeHdr(firstMatch(HDR_RE, text)),
    audio: audio?.toLowerCase() || null,
    audioCodec: normalizeAudio(audio),
    audioProfile: firstMatch(AUDIO_PROFILE_RE, text)?.toLowerCase() || null,
    audioChannels: normalizeChannels(firstMatch(CHANNEL_RE, text)),
    service: normalizeService(firstMatch(SERVICE_RE, text)),
    year: year ? Number.parseInt(year, 10) : null,
    season: se.season,
    episode: se.episode,
    fps: fps ? Number.parseFloat(String(fps).replace(',', '.')) : null,
    edition: editions.length ? editions.join('+') : null,
    editions,
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

export function normalizedStringSimilarity(left, right) {
  const a = stableFingerprint(left).slice(0, 180);
  const b = stableFingerprint(right).slice(0, 180);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column++) {
      const above = previous[column];
      const substitution = diagonal + (a[row - 1] === b[column - 1] ? 0 : 1);
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, substitution);
      diagonal = above;
    }
  }
  return 1 - (previous[b.length] / Math.max(a.length, b.length));
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
