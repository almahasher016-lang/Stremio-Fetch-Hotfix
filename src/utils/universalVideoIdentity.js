import { parseRelease, stableFingerprint } from './releaseParser.js';

const SUBTITLE_OR_ARCHIVE_EXTENSIONS = new Set([
  'srt', 'ass', 'ssa', 'vtt', 'sub', 'idx', 'sup', 'ttml', 'dfxp', 'smi', 'sami',
  'zip', 'rar', '7z', 'gz', 'bz2', 'xz', 'tar',
]);

const CONTAINER_ALIASES = new Map([
  ['mkv', 'matroska'], ['mk3d', 'matroska'], ['webm', 'webm'],
  ['mp4', 'mp4'], ['m4v', 'mp4'], ['mov', 'quicktime'], ['qt', 'quicktime'],
  ['avi', 'avi'], ['wmv', 'asf'], ['asf', 'asf'], ['flv', 'flash-video'], ['f4v', 'flash-video'],
  ['ts', 'mpeg-ts'], ['m2ts', 'mpeg-ts'], ['mts', 'mpeg-ts'], ['m2t', 'mpeg-ts'],
  ['mpg', 'mpeg-ps'], ['mpeg', 'mpeg-ps'], ['mpe', 'mpeg-ps'], ['vob', 'mpeg-ps'],
  ['3gp', '3gpp'], ['3g2', '3gpp2'], ['ogv', 'ogg-video'], ['ogg', 'ogg'],
  ['mxf', 'mxf'], ['rm', 'realmedia'], ['rmvb', 'realmedia'], ['iso', 'disc-image'],
  ['nut', 'nut'], ['nsv', 'nsv'], ['divx', 'avi'], ['amv', 'amv'], ['y4m', 'yuv4mpeg'],
]);

const EDITION_PATTERNS = [
  ['directors-cut', /\bdirector(?:'s|s)?[ ._-]*(?:cut|edition|version)\b/i],
  ['extended', /\bextended(?:[ ._-]*(?:cut|edition|version))?\b/i],
  ['theatrical', /\btheatrical(?:[ ._-]*(?:cut|edition|version))?\b/i],
  ['unrated', /\bunrated(?:[ ._-]*(?:cut|edition|version))?\b/i],
  ['imax', /\bimax(?:[ ._-]*(?:cut|edition|version))?\b/i],
  ['open-matte', /\bopen[ ._-]*matte\b/i],
  ['criterion', /\bcriterion(?:[ ._-]*(?:collection|edition))?\b/i],
  ['remastered', /\b(?:re[ ._-]?master(?:ed)?|remastered)(?:[ ._-]*edition)?\b/i],
  ['alternate-cut', /\b(?:alternate|alternative)[ ._-]*(?:cut|version|ending)\b/i],
  ['fanedit', /\bfan[ ._-]*edit\b/i],
];

const VISUAL_RESOLUTION_RE = /\b(8640p|8k|4320p|4k|2160p|1440p|2k|1080[pi]|720[pi]|576[pi]|540p|480[pi]|360p|240p)\b/i;
const FPS_RE = /(?:^|[\s._-])(120(?:\.0+)?|119\.88|60(?:\.0+)?|59\.94|50(?:\.0+)?|48(?:\.0+)?|47\.952|30(?:\.0+)?|29\.97|25(?:\.0+)?|24(?:\.0+)?|23\.98|23\.976)(?:\s*fps\b|(?=[\s._-]|$))/i;
const DURATION_CLOCK_RE = /\b(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\b/;

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function firstDefined(values) {
  return values.find(value => value !== undefined && value !== null && text(value) !== '');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInt(value) {
  const number = finite(value);
  return number != null && number > 0 ? Math.round(number) : null;
}

function normalizeFps(value) {
  const number = finite(value);
  if (!(number > 0 && number <= 240)) return null;
  const canonical = [23.976, 23.98, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 119.88, 120];
  const close = canonical.find(item => Math.abs(item - number) <= 0.015);
  return Number((close ?? number).toFixed(3));
}

function normalizeDurationMs(value) {
  const number = finite(value);
  if (!(number > 0)) return null;
  // Durations below ten hours expressed as seconds are common in media metadata.
  if (number < 36_000) return Math.round(number * 1000);
  return Math.round(number);
}

function durationFromClock(value) {
  const match = text(value).match(DURATION_CLOCK_RE);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(String(match[4] || '0').padEnd(3, '0'));
  if (minutes > 59 || seconds > 59) return null;
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + millis;
}

function normalizeResolution(value) {
  const raw = lower(value).replace(/\s+/g, '');
  if (!raw) return null;
  if (raw === '8k' || raw === '8640p') return '4320p';
  if (raw === '4k' || raw === 'uhd') return '2160p';
  if (raw === '2k') return '1440p';
  return raw;
}

function normalizeCodec(value) {
  const raw = lower(value).replace(/[ ._-]/g, '');
  if (!raw) return null;
  if (['x264', 'h264', 'avc', 'avc1'].includes(raw)) return 'h264';
  if (['x265', 'h265', 'hevc', 'hev1', 'hvc1'].includes(raw)) return 'hevc';
  if (['av01', 'av1'].includes(raw)) return 'av1';
  if (['vp09', 'vp9'].includes(raw)) return 'vp9';
  if (['mpeg2video', 'mpeg2'].includes(raw)) return 'mpeg2';
  if (['mpeg4', 'mp4v'].includes(raw)) return 'mpeg4';
  return raw.slice(0, 32);
}

function normalizeHdr(value) {
  const raw = lower(value).replace(/[ ._-]/g, '');
  if (!raw) return null;
  if (['dv', 'dovi', 'dolbyvision'].includes(raw)) return 'dolby-vision';
  if (['hdr10plus', 'hdr10+'].includes(raw)) return 'hdr10+';
  if (raw === 'hdr10') return 'hdr10';
  if (raw === 'hlg') return 'hlg';
  if (raw === 'sdr') return 'sdr';
  return raw.slice(0, 32);
}

function normalizeContainer(value) {
  const raw = lower(value).replace(/^\./, '');
  if (!raw) return null;
  return CONTAINER_ALIASES.get(raw) || raw.slice(0, 24);
}

function normalizeService(value) {
  const raw = lower(value).replace(/[ ._-]/g, '');
  if (!raw) return null;
  if (['amazon', 'amzn', 'primevideo'].includes(raw)) return 'amazon';
  if (['netflix', 'nf'].includes(raw)) return 'netflix';
  if (['disneyplus', 'dsnp'].includes(raw)) return 'disney-plus';
  if (['appletvplus', 'atvp'].includes(raw)) return 'apple-tv-plus';
  if (['hmax', 'hbomax', 'max'].includes(raw)) return 'max';
  if (['hulu'].includes(raw)) return 'hulu';
  if (['paramountplus', 'pmtp'].includes(raw)) return 'paramount-plus';
  if (['peacock', 'pcok'].includes(raw)) return 'peacock';
  if (['crave', 'crav'].includes(raw)) return 'crave';
  if (['stan'].includes(raw)) return 'stan';
  return raw.slice(0, 32);
}

export function detectVideoContainer(filename = '', explicitContainer = '') {
  if (text(explicitContainer)) return normalizeContainer(explicitContainer);
  const clean = text(filename).split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-z0-9]{1,12})$/i);
  if (!match) return null;
  const extension = lower(match[1]);
  if (SUBTITLE_OR_ARCHIVE_EXTENSIONS.has(extension)) return null;
  return normalizeContainer(extension);
}

function detectSourceFamily(value = '') {
  const raw = lower(value).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
  if (!raw) return '';
  if (/\b(?:web\s*(?:dl|rip|mux|remux)?|webdl|webrip|webmux|webremux)\b/.test(raw)) return 'web';
  if (/\b(?:uhd\s*(?:blu\s*ray|bd)|blu\s*ray|bluray|bd\s*(?:rip|remux|mv)|bdrip|bdremux|bdmv|br\s*rip|brrip|bd25|bd50|bd66|bd100)\b/.test(raw)) return 'bluray';
  if (/\b(?:hdtv|hdtvrip|dtv|dvb|pdtv|satrip|sat\s*rip|dsr)\b/.test(raw)) return 'hdtv';
  if (/\b(?:dvd|dvd5|dvd9|dvdrip|dvd\s*rip)\b/.test(raw)) return 'dvd';
  if (/\b(?:hdcam|hqcam|camrip|cam|telesync|telecine|hdts)\b/.test(raw)) return 'cam';
  if (/\b(?:dvdscr|bdscr|screener)\b/.test(raw)) return 'screener';
  if (/\b(?:vhsrip|vhs|laserdisc|laser\s*disc)\b/.test(raw)) return 'legacy-disc';
  // Bare REMUX is normally BluRay/UHD-BluRay derived. WEB remux has already matched above.
  if (/\bremux\b/.test(raw)) return 'bluray';
  return '';
}

function detectSourceDetail(value = '') {
  const raw = lower(value).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
  if (/\b(?:web\s*remux|webremux|web\s*mux|webmux)\b/.test(raw)) return 'web-remux';
  if (/\b(?:web\s*dl|webdl)\b/.test(raw)) return 'web-dl';
  if (/\b(?:web\s*rip|webrip)\b/.test(raw)) return 'web-rip';
  const hasRemux = /\bremux\b/.test(raw);
  const hasUhdBluray = /\b(?:uhd\s*(?:blu\s*ray|bd)|bd100|bd66)\b/.test(raw);
  const hasBluray = /\b(?:blu\s*ray|bluray|bd\s*(?:remux|mv)|bdremux|bdmv|bd25|bd50|bd66|bd100)\b/.test(raw);
  if (hasRemux && hasUhdBluray) return 'uhd-bluray-remux';
  if (hasRemux && hasBluray) return 'bluray-remux';
  if (/\b(?:bd\s*rip|bdrip|br\s*rip|brrip|blu\s*ray|bluray)\b/.test(raw)) return 'bluray';
  if (/\bhdtv\b/.test(raw)) return 'hdtv';
  if (/\bdvd\s*rip|\bdvdrip\b/.test(raw)) return 'dvd-rip';
  if (/\btelesync\b|\bhdts\b/.test(raw)) return 'telesync';
  if (/\btelecine\b/.test(raw)) return 'telecine';
  if (/\bcam\b|\bhdcam\b|\bhqcam\b/.test(raw)) return 'cam';
  return '';
}

function normalizeReleaseGroup(value) {
  const raw = text(value)
    .replace(/^[\[({]+|[\])}]+$/g, '')
    .replace(/\.(?:mkv|mk3d|webm|mp4|m4v|mov|qt|avi|wmv|asf|flv|f4v|ts|m2ts|mts|m2t|mpg|mpeg|mpe|vob|3gp|3g2|ogv|ogg|mxf|rm|rmvb|iso|nut|nsv|divx|amv|y4m)$/i, '')
    .replace(/[._]+$/g, '');
  if (!raw || raw.length > 48) return null;
  return raw.toUpperCase();
}

function detectEditions(raw, parsed) {
  const found = new Set(Array.isArray(parsed?.editions) ? parsed.editions : []);
  for (const [name, pattern] of EDITION_PATTERNS) {
    if (pattern.test(raw)) found.add(name);
  }
  return [...found].sort();
}

function setEquals(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function optionalEquals(left, right) {
  if (!left || !right) return null;
  return lower(left) === lower(right);
}

function fpsComparison(left, right) {
  if (!(left > 0) || !(right > 0)) return null;
  return Math.abs(left - right) <= 0.03;
}

function durationComparison(left, right) {
  if (!(left > 0) || !(right > 0)) return { match: null, conflict: false, deltaMs: null };
  const deltaMs = Math.abs(left - right);
  const base = Math.min(left, right);
  const strongTolerance = Math.max(2500, Math.round(base * 0.0005));
  const conflictTolerance = Math.max(12_000, Math.round(base * 0.002));
  return {
    match: deltaMs <= strongTolerance,
    conflict: deltaMs > conflictTolerance,
    deltaMs,
  };
}

function hashValue(source = {}) {
  return lower(firstDefined([
    source.videoHash, source.movieHash, source.moviehash, source.hash,
    source.extra?.videoHash, source.extra?.movieHash, source.extra?.hash,
  ]));
}

function extractFilenameFps(raw) {
  const match = text(raw).match(FPS_RE);
  return match ? normalizeFps(match[1]) : null;
}

function visualResolution(raw, source = {}, parsed = {}) {
  const explicit = firstDefined([source.resolution, source.extra?.resolution, source.extra?.video_resolution, parsed.quality]);
  if (explicit) return normalizeResolution(explicit);
  const match = text(raw).match(VISUAL_RESOLUTION_RE);
  return normalizeResolution(match?.[1]);
}

export function buildUniversalVideoProfile(source = {}) {
  const extra = source.extra && typeof source.extra === 'object' ? source.extra : {};
  const raw = text(firstDefined([
    source.filename, source.releaseName, source.fileName, source.name, source.title,
    extra.filename, extra.fileName, extra.name,
  ]));
  const parsed = source.parsedRelease || parseRelease(raw);
  const sourceText = [
    raw, source.source, source.sourceFamily, extra.source, extra.videoSource, parsed.source,
  ].filter(Boolean).join(' ');
  const sourceFamily = detectSourceFamily(sourceText);
  const sourceDetail = detectSourceDetail(sourceText);
  const releaseGroup = normalizeReleaseGroup(firstDefined([
    source.releaseGroup, source.release_group, extra.releaseGroup, extra.release_group, parsed.releaseGroup,
  ]));
  const service = normalizeService(firstDefined([source.service, extra.service, extra.streamingService, parsed.service]));
  const editions = detectEditions([
    raw, source.edition, extra.edition, extra.cut, extra.videoEdition,
  ].filter(Boolean).join(' '), parsed);
  const fps = normalizeFps(firstDefined([
    source.fps, source.frameRate, source.frame_rate, extra.fps, extra.frameRate, extra.frame_rate, parsed.fps,
  ])) || extractFilenameFps(raw);
  const durationMs = normalizeDurationMs(firstDefined([
    source.durationMs, source.videoDurationMs, source.runtimeMs,
    extra.durationMs, extra.videoDurationMs, extra.runtimeMs, extra.duration,
  ])) || durationFromClock(firstDefined([source.runtime, extra.runtime, extra.durationText]));
  const width = positiveInt(firstDefined([source.width, extra.width]));
  const height = positiveInt(firstDefined([source.height, extra.height]));
  const resolution = visualResolution(raw, source, parsed) || (height ? `${height}p` : null);
  const codec = normalizeCodec(firstDefined([
    source.videoCodec, source.video_codec, extra.videoCodec, extra.video_codec, parsed.codecFamily, parsed.codec,
  ]));
  const hdr = normalizeHdr(firstDefined([source.hdr, extra.hdr, parsed.hdr]));
  const container = detectVideoContainer(raw, firstDefined([source.container, extra.container, extra.videoContainer]));
  const videoHash = hashValue(source) || null;
  const videoSize = positiveInt(firstDefined([source.videoSize, source.movieByteSize, source.moviebytesize, source.size, extra.videoSize, extra.size]));
  // The normalized timeline identity deliberately excludes container, resolution, codec,
  // HDR/audio and source detail such as UHD-REMUX vs BluRay encode. Those can differ while
  // the underlying cut/timeline remains identical. Family + service/group + edition/FPS/duration
  // are the signals that may safely define a reusable timing cache identity.
  const timingSignature = [
    sourceFamily || '?', service || '?', releaseGroup || '?',
    editions.join('+') || '?', fps || '?', durationMs || '?',
  ].join('|');
  const visualSignature = [container || '?', resolution || '?', codec || '?', hdr || '?'].join('|');

  return {
    raw,
    rawFingerprint: stableFingerprint(raw),
    videoHash,
    videoSize,
    sourceFamily,
    sourceDetail,
    service,
    releaseGroup,
    editions,
    editionKey: editions.join('+') || null,
    fps,
    durationMs,
    container,
    resolution,
    width,
    height,
    codec,
    hdr,
    timingSignature,
    visualSignature,
  };
}

export function compareUniversalVideoProfiles(targetInput = {}, candidateInput = {}, { mediaType = 'movie' } = {}) {
  const target = targetInput?.timingSignature ? targetInput : buildUniversalVideoProfile(targetInput);
  const candidate = candidateInput?.timingSignature ? candidateInput : buildUniversalVideoProfile(candidateInput);
  const exactHash = Boolean(target.videoHash && candidate.videoHash && target.videoHash === candidate.videoHash);
  const fpsMatch = fpsComparison(target.fps, candidate.fps);
  const duration = durationComparison(target.durationMs, candidate.durationMs);
  const sourceMatch = optionalEquals(target.sourceFamily, candidate.sourceFamily);
  const detailMatch = optionalEquals(target.sourceDetail, candidate.sourceDetail);
  const serviceMatch = optionalEquals(target.service, candidate.service);
  const releaseGroupMatch = optionalEquals(target.releaseGroup, candidate.releaseGroup);
  const editionsComparable = target.editions.length > 0 && candidate.editions.length > 0;
  const editionMatch = editionsComparable ? setEquals(target.editions, candidate.editions) : null;
  const conflicts = [];
  if (fpsMatch === false) conflicts.push('fps');
  if (editionMatch === false) conflicts.push('edition');
  if (duration.conflict) conflicts.push('duration');

  const positiveSignals = [
    serviceMatch === true,
    releaseGroupMatch === true,
    fpsMatch === true,
    duration.match === true,
    detailMatch === true,
  ].filter(Boolean).length;

  let tier = 0;
  let compatibility = 'unknown';
  if (conflicts.length) {
    compatibility = 'incompatible';
  } else if (exactHash) {
    tier = 10;
    compatibility = 'exact';
  } else if (duration.match === true && fpsMatch === true && sourceMatch !== false) {
    tier = positiveSignals >= 4 ? 9 : 8;
    compatibility = 'high';
  } else if (sourceMatch === true && positiveSignals >= 3) {
    tier = 7;
    compatibility = 'high';
  } else if (sourceMatch === true && positiveSignals >= 1) {
    tier = 6;
    compatibility = 'compatible';
  } else if (sourceMatch === true) {
    tier = mediaType === 'series' ? 5 : 4;
    compatibility = 'compatible';
  } else if (sourceMatch == null && (releaseGroupMatch === true || serviceMatch === true) && fpsMatch !== false) {
    tier = 4;
    compatibility = 'compatible';
  }

  return {
    target,
    candidate,
    exactHash,
    compatibility,
    tier,
    hardConflict: conflicts.length > 0,
    conflicts,
    sourceMatch,
    sourceFamily: candidate.sourceFamily,
    targetSourceFamily: target.sourceFamily,
    sourceDetailMatch: detailMatch,
    serviceMatch,
    releaseGroupMatch,
    editionMatch,
    fpsMatch,
    durationMatch: duration.match,
    durationDeltaMs: duration.deltaMs,
    stableReleaseFamily: !conflicts.length && tier >= 5,
    // Visual/container differences are diagnostics only. They never create timing conflicts.
    formatDifferences: {
      container: target.container && candidate.container && target.container !== candidate.container,
      resolution: target.resolution && candidate.resolution && target.resolution !== candidate.resolution,
      codec: target.codec && candidate.codec && target.codec !== candidate.codec,
      hdr: target.hdr && candidate.hdr && target.hdr !== candidate.hdr,
    },
  };
}

export function __universalIdentityInternalsForTests() {
  return {
    detectSourceFamily,
    detectSourceDetail,
    normalizeFps,
    normalizeDurationMs,
    normalizeContainer,
    normalizeService,
  };
}
