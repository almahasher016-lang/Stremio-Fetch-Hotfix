import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { parseRelease } from '../utils/releaseParser.js';

const HASH_CHUNK_BYTES = 64 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 3 * 1024 * 1024;
const UINT64_MASK = (1n << 64n) - 1n;
const ARABIC_CODES = new Set(['ar', 'ara', 'arabic', 'arb', 'arq', 'ary', 'arz']);
const VIDEO_EXTENSIONS = new Set(['.3gp', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.mts', '.ts', '.webm', '.wmv']);
const INDEX_FILENAME = '.m7md-companion-index.json';
const DEFAULT_WATCH_INTERVAL_MS = 15_000;

function defaultAdminToken() {
  return config.versionRegistry.authToken || config.vault.authToken || '';
}

function cleanBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  const parsed = new URL(normalized);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Server URL must use http or https');
  if (parsed.search || parsed.hash) throw new Error('Server URL must not contain a query or hash');
  return parsed.toString().replace(/\/$/, '');
}

function positiveInteger(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function cleanImdb(value) {
  const match = String(value || '').match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function displayError(error) {
  const message = String(error?.message || error || 'Unknown error');
  return message.replace(/\s+/g, ' ').trim();
}

function collectProcessOutput(chunks, chunk, state, child, reject) {
  state.bytes += chunk.length;
  if (state.bytes > state.maxBytes) {
    child.kill();
    reject(new Error(`Process output exceeded ${state.maxBytes} bytes`));
    return;
  }
  chunks.push(Buffer.from(chunk));
}

export function runBinary(binary, args, { maxBytes = MAX_PROCESS_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const stdoutState = { bytes: 0, maxBytes };
    const stderrState = { bytes: 0, maxBytes };
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on('data', chunk => collectProcessOutput(stdout, chunk, stdoutState, child, fail));
    child.stderr.on('data', chunk => collectProcessOutput(stderr, chunk, stderrState, child, fail));
    child.once('error', fail);
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        return fail(new Error(`${binary} failed${signal ? ` (${signal})` : ''}: ${Buffer.concat(stderr).toString('utf8').trim() || `exit ${code}`}`));
      }
      settled = true;
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

async function readExactly(file, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset !== length) throw new Error('Could not read the required video bytes');
  return buffer;
}

export async function fingerprintVideoFile(filePath) {
  const file = await fs.open(filePath, 'r');
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error('The supplied path is not a video file');
    if (stats.size < HASH_CHUNK_BYTES * 2) throw new Error('OpenSubtitles hash requires a video file of at least 128 KiB');
    let sum = BigInt(stats.size);
    for (const position of [0, stats.size - HASH_CHUNK_BYTES]) {
      const buffer = await readExactly(file, position, HASH_CHUNK_BYTES);
      for (let offset = 0; offset < buffer.length; offset += 8) {
        sum = (sum + buffer.readBigUInt64LE(offset)) & UINT64_MASK;
      }
    }
    return { videoHash: sum.toString(16).padStart(16, '0'), videoSize: stats.size };
  } finally {
    await file.close();
  }
}

export async function calculateOpenSubtitlesHash(filePath) {
  return (await fingerprintVideoFile(filePath)).videoHash;
}

function toDurationMs(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

export function parseFrameRate(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '0/0') return null;
  const [numeratorText, denominatorText] = text.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null;
  const fps = numerator / denominator;
  if (fps < 1 || fps > 240) return null;
  return Number(fps.toFixed(3));
}

function resolutionFromHeight(height) {
  const pixels = Number(height);
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  if (pixels >= 4000) return '4320p';
  if (pixels >= 2000) return '2160p';
  if (pixels >= 1300) return '1440p';
  if (pixels >= 1000) return '1080p';
  if (pixels >= 700) return '720p';
  if (pixels >= 560) return '576p';
  return '480p';
}

function channelsLabel(stream = {}) {
  const channels = Number(stream.channels);
  if (channels === 1) return '1.0';
  if (channels === 2) return '2.0';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  if (Number.isInteger(channels) && channels > 0) return String(channels);
  const layout = String(stream.channel_layout || '').toLowerCase();
  const match = layout.match(/\b(1\.0|2\.0|5\.1|7\.1)\b/);
  return match?.[1] || null;
}

function hdrLabel(stream = {}) {
  const codec = String(stream.codec_name || '').toLowerCase();
  const profile = String(stream.profile || '').toLowerCase();
  const transfer = String(stream.color_transfer || '').toLowerCase();
  if (/dovi|dolby.?vision/.test(`${codec} ${profile}`)) return 'dolby-vision';
  if (transfer === 'smpte2084') return 'hdr10';
  if (transfer === 'arib-std-b67') return 'hlg';
  return null;
}

export function summarizeProbeOutput(output = {}) {
  const streams = Array.isArray(output.streams) ? output.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video') || {};
  const audioStreams = streams.filter(stream => stream.codec_type === 'audio');
  const audio = audioStreams.find(stream => stream.disposition?.default) || audioStreams[0] || {};
  const embeddedSubtitles = streams
    .filter(stream => stream.codec_type === 'subtitle')
    .map(subtitleStream)
    .filter(stream => Number.isInteger(stream.index));
  const durationMs = toDurationMs(output.format?.duration)
    || streams.map(stream => toDurationMs(stream.duration)).find(Boolean)
    || null;
  const fps = parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate);
  const width = Number.isFinite(Number(video.width)) && Number(video.width) > 0 ? Number(video.width) : null;
  const height = Number.isFinite(Number(video.height)) && Number(video.height) > 0 ? Number(video.height) : null;
  return {
    durationMs,
    fps,
    width,
    height,
    resolution: resolutionFromHeight(height),
    videoCodec: String(video.codec_name || '').toLowerCase() || null,
    pixelFormat: String(video.pix_fmt || '').toLowerCase() || null,
    hdr: hdrLabel(video),
    audioCodec: String(audio.codec_name || '').toLowerCase() || null,
    audioChannels: channelsLabel(audio),
    container: String(output.format?.format_name || '').split(',')[0].toLowerCase() || null,
    embeddedSubtitles,
  };
}

function subtitleStream(stream = {}) {
  const tags = stream.tags || {};
  const disposition = stream.disposition || {};
  return {
    index: Number(stream.index),
    codec: String(stream.codec_name || ''),
    language: String(tags.language || 'und').toLowerCase(),
    title: String(tags.title || ''),
    default: Boolean(disposition.default),
    forced: Boolean(disposition.forced),
    hearingImpaired: Boolean(disposition.hearing_impaired),
  };
}

function isArabicStream(stream = {}) {
  const language = String(stream.language || '').toLowerCase();
  const primary = language.split(/[-_]/)[0];
  return ARABIC_CODES.has(language) || ARABIC_CODES.has(primary) || /arabic|العربية|عربي/i.test(String(stream.title || ''));
}

export async function probeMedia(filePath, { ffprobe = 'ffprobe' } = {}) {
  try {
    const { stdout } = await runBinary(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], { maxBytes: 2 * 1024 * 1024 });
    const output = JSON.parse(stdout.toString('utf8'));
    return { available: true, ...summarizeProbeOutput(output), warning: null };
  } catch (error) {
    return {
      available: false,
      durationMs: null,
      fps: null,
      width: null,
      height: null,
      resolution: null,
      videoCodec: null,
      pixelFormat: null,
      hdr: null,
      audioCodec: null,
      audioChannels: null,
      container: null,
      embeddedSubtitles: [],
      warning: displayError(error),
    };
  }
}

async function postJson(server, route, body, token) {
  const response = await fetch(`${server}${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-admin-token': token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.providers.timeoutMs),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text };
  }
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${payload?.error || payload?.message || text || 'request failed'}`);
  return payload;
}

async function extractArabicStreams(filePath, streams, options, media) {
  const arabicStreams = streams.filter(isArabicStream);
  const uploads = [];
  const failures = [];
  for (const stream of arabicStreams) {
    try {
      const { stdout } = await runBinary(options.ffmpeg, ['-v', 'error', '-nostdin', '-i', filePath, '-map', `0:${stream.index}`, '-f', 'srt', '-'], { maxBytes: 2 * 1024 * 1024 });
      const text = stdout.toString('utf8').replace(/\r\n/g, '\n').trim();
      if (!/-->/.test(text)) throw new Error('The extracted stream is not valid SRT text');
      const name = `${path.basename(filePath)} · ${stream.title || stream.language || `stream ${stream.index}`}`.slice(0, 180);
      const response = await postJson(options.server, '/api/vault', {
        name,
        imdbId: media.imdbId,
        tmdbId: media.tmdbId,
        type: media.type,
        season: media.season,
        episode: media.episode,
        videoHash: media.videoHash,
        filename: media.filename,
        releaseName: media.filename,
        lang: 'ar',
        hearingImpaired: stream.hearingImpaired,
        text,
      }, options.token);
      uploads.push({ index: stream.index, title: stream.title, vaultId: response.item?.id || null, bytes: Buffer.byteLength(text, 'utf8') });
    } catch (error) {
      failures.push({ index: stream.index, title: stream.title, error: displayError(error) });
    }
  }
  return { found: arabicStreams.length, uploads, failures };
}

export function parseScanArgs(args = []) {
  if (!args.length) throw new Error('A video file path is required');
  const input = [...args];
  const watchFirst = input[0] === '--watch';
  if (watchFirst) input.shift();
  const videoPath = input.shift();
  if (!videoPath || videoPath.startsWith('--')) throw new Error('A video file or directory path is required');
  const tokens = input;
  const options = {
    type: 'movie',
    ffprobe: 'ffprobe',
    ffmpeg: 'ffmpeg',
    token: defaultAdminToken(),
    extractArabic: false,
    dryRun: false,
    json: false,
    watch: watchFirst,
    rescan: false,
    indexPath: '',
    watchIntervalMs: DEFAULT_WATCH_INTERVAL_MS,
  };
  const aliases = {
    server: 'server', token: 'token', imdb: 'imdbId', 'imdb-id': 'imdbId', tmdb: 'tmdbId', 'tmdb-id': 'tmdbId',
    type: 'type', season: 'season', episode: 'episode', title: 'title', 'duration-ms': 'durationMs', ffprobe: 'ffprobe', ffmpeg: 'ffmpeg',
    index: 'indexPath', 'watch-interval-ms': 'watchIntervalMs',
  };
  const flags = new Set(['extract-arabic', 'dry-run', 'json', 'watch', 'rescan']);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equalsAt = token.indexOf('=');
    const rawName = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1);
    if (flags.has(rawName)) {
      if (inlineValue !== undefined) throw new Error(`--${rawName} does not accept a value`);
      const optionName = rawName === 'extract-arabic'
        ? 'extractArabic'
        : rawName === 'dry-run'
          ? 'dryRun'
          : rawName;
      options[optionName] = true;
      continue;
    }
    const name = aliases[rawName];
    if (!name) throw new Error(`Unsupported option: --${rawName}`);
    const value = inlineValue ?? tokens[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${rawName} requires a value`);
    options[name] = value;
  }
  options.server = options.server ? cleanBaseUrl(options.server) : '';
  options.imdbId = cleanImdb(options.imdbId);
  options.season = positiveInteger(options.season, 'season');
  options.episode = positiveInteger(options.episode, 'episode');
  options.durationMs = positiveInteger(options.durationMs, 'duration-ms');
  options.watchIntervalMs = positiveInteger(options.watchIntervalMs, 'watch-interval-ms') || DEFAULT_WATCH_INTERVAL_MS;
  if (options.watchIntervalMs < 1_000) throw new Error('watch-interval-ms must be at least 1000');
  options.indexPath = options.indexPath ? path.resolve(String(options.indexPath)) : '';
  options.type = String(options.type || 'movie').toLowerCase();
  if (!['movie', 'series'].includes(options.type)) throw new Error('type must be movie or series');
  if (options.extractArabic && !options.server) throw new Error('--extract-arabic requires --server');
  if (!options.dryRun && !options.server) throw new Error('--server is required unless --dry-run is used');
  return { videoPath, options };
}

export async function scanMedia(videoPath, options = {}) {
  const normalizedOptions = {
    type: options.type || 'movie',
    ffprobe: options.ffprobe || 'ffprobe',
    ffmpeg: options.ffmpeg || 'ffmpeg',
    extractArabic: Boolean(options.extractArabic),
    dryRun: Boolean(options.dryRun),
    server: options.server ? cleanBaseUrl(options.server) : '',
    token: options.token || defaultAdminToken(),
    imdbId: cleanImdb(options.imdbId),
    tmdbId: options.tmdbId ? String(options.tmdbId) : null,
    season: positiveInteger(options.season, 'season'),
    episode: positiveInteger(options.episode, 'episode'),
    durationMs: positiveInteger(options.durationMs, 'duration-ms'),
    title: String(options.title || '').trim(),
  };
  if (!normalizedOptions.dryRun && !normalizedOptions.server) throw new Error('--server is required unless --dry-run is used');
  const [fingerprint, probe] = await Promise.all([fingerprintVideoFile(videoPath), probeMedia(videoPath, normalizedOptions)]);
  const media = {
    type: normalizedOptions.type,
    id: normalizedOptions.imdbId || normalizedOptions.tmdbId || normalizedOptions.title || path.basename(videoPath),
    imdbId: normalizedOptions.imdbId,
    tmdbId: normalizedOptions.tmdbId,
    season: normalizedOptions.season,
    episode: normalizedOptions.episode,
    title: normalizedOptions.title,
    filename: path.basename(videoPath),
    videoHash: fingerprint.videoHash,
    videoSize: fingerprint.videoSize,
    durationMs: normalizedOptions.durationMs || probe.durationMs,
    fps: probe.fps,
    width: probe.width,
    height: probe.height,
    resolution: probe.resolution,
    videoCodec: probe.videoCodec,
    pixelFormat: probe.pixelFormat,
    hdr: probe.hdr,
    audioCodec: probe.audioCodec,
    audioChannels: probe.audioChannels,
    container: probe.container,
    embeddedSubtitles: probe.embeddedSubtitles,
  };
  const result = {
    media,
    probe: {
      available: probe.available,
      warning: probe.warning,
      fps: probe.fps,
      resolution: probe.resolution,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      audioChannels: probe.audioChannels,
      container: probe.container,
    },
    registry: null,
    extraction: null,
  };
  if (!normalizedOptions.dryRun) result.registry = await postJson(normalizedOptions.server, '/api/companion/media', media, normalizedOptions.token);
  if (normalizedOptions.extractArabic && normalizedOptions.dryRun) {
    result.extraction = { found: probe.embeddedSubtitles.filter(isArabicStream).length, uploads: [], failures: [], skipped: 'dry-run' };
  } else if (normalizedOptions.extractArabic) {
    if (!probe.available) throw new Error(`Arabic extraction needs ffprobe: ${probe.warning}`);
    result.extraction = await extractArabicStreams(videoPath, probe.embeddedSubtitles, normalizedOptions, media);
  }
  return result;
}

function videoFilePath(value) {
  return VIDEO_EXTENSIONS.has(path.extname(String(value || '')).toLowerCase());
}

export async function listVideoFiles(directory) {
  const root = path.resolve(directory);
  const files = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && videoFilePath(entry.name)) {
        files.push(absolute);
      }
    }
  }
  await visit(root);
  return files;
}

function emptyDirectoryIndex() {
  return { version: 1, appVersion: config.app.version, updatedAt: null, files: {} };
}

async function loadDirectoryIndex(indexPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (!parsed || parsed.version !== 1 || !parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
      return emptyDirectoryIndex();
    }
    return { ...emptyDirectoryIndex(), ...parsed, files: parsed.files };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return emptyDirectoryIndex();
  }
}

async function persistDirectoryIndex(indexPath, index) {
  const snapshot = `${JSON.stringify({
    ...index,
    appVersion: config.app.version,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`;
  const temporaryPath = `${indexPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, snapshot, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, indexPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function relativeMediaKey(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function inferredFileOptions(filePath, options) {
  const parsed = parseRelease(path.basename(filePath));
  const inferredSeries = Boolean(parsed.season && parsed.episode);
  return {
    ...options,
    type: inferredSeries ? 'series' : options.type,
    season: options.season || parsed.season,
    episode: options.episode || parsed.episode,
  };
}

export async function scanMediaDirectory(directory, options = {}, dependencies = {}) {
  const root = path.resolve(directory);
  const rootStats = await fs.stat(root);
  if (!rootStats.isDirectory()) throw new Error('The supplied watch path is not a directory');
  const indexPath = options.indexPath ? path.resolve(options.indexPath) : path.join(root, INDEX_FILENAME);
  const scanner = dependencies.scanMedia || scanMedia;
  const index = await loadDirectoryIndex(indexPath);
  const files = await listVideoFiles(root);
  const seen = new Set();
  const processed = [];
  const skipped = [];
  const failures = [];
  let changed = false;

  for (const filePath of files) {
    const key = relativeMediaKey(root, filePath);
    seen.add(key);
    const stats = await fs.stat(filePath);
    const size = stats.size;
    const mtimeMs = Math.round(stats.mtimeMs);
    const previous = index.files[key];
    if (!options.rescan && previous?.size === size && previous?.mtimeMs === mtimeMs) {
      skipped.push(key);
      continue;
    }
    try {
      const result = await scanner(filePath, inferredFileOptions(filePath, options));
      const media = result?.media || {};
      index.files[key] = {
        size,
        mtimeMs,
        videoHash: media.videoHash || null,
        videoSize: media.videoSize || size,
        durationMs: media.durationMs || null,
        fps: media.fps || null,
        resolution: media.resolution || null,
        videoCodec: media.videoCodec || null,
        audioCodec: media.audioCodec || null,
        audioChannels: media.audioChannels || null,
        type: media.type || null,
        season: media.season || null,
        episode: media.episode || null,
        scannedAt: new Date().toISOString(),
      };
      processed.push({ file: key, media, extraction: result?.extraction || null });
      changed = true;
    } catch (error) {
      failures.push({ file: key, error: displayError(error) });
    }
  }

  let removed = 0;
  for (const key of Object.keys(index.files)) {
    if (seen.has(key)) continue;
    delete index.files[key];
    removed += 1;
    changed = true;
  }
  if (!options.dryRun && changed) await persistDirectoryIndex(indexPath, index);
  return {
    directory: root,
    indexPath,
    discovered: files.length,
    processed,
    skipped,
    failures,
    removed,
  };
}

function waitForNextCycle(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener('abort', finish);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function watchMediaDirectory(directory, options = {}, {
  signal,
  onCycle,
  scanMedia: scanner,
} = {}) {
  let firstCycle = true;
  let cycles = 0;
  while (!signal?.aborted) {
    const result = await scanMediaDirectory(directory, {
      ...options,
      rescan: firstCycle ? options.rescan : false,
    }, scanner ? { scanMedia: scanner } : {});
    cycles += 1;
    await onCycle?.(result);
    firstCycle = false;
    if (signal?.aborted) break;
    await waitForNextCycle(options.watchIntervalMs || DEFAULT_WATCH_INTERVAL_MS, signal);
  }
  return { cycles, stopped: Boolean(signal?.aborted) };
}

function usage() {
  return [
    'Usage:',
    '  npm run companion:scan -- "D:\\Video\\movie.mkv" --server https://your-addon.example --imdb tt1375666',
    '  npm run companion:scan -- "D:\\Video\\episode.mkv" --server https://your-addon.example --imdb tt11198330 --type series --season 1 --episode 1 --extract-arabic',
    '  npm run companion:scan -- --watch "D:\\Media" --server https://your-addon.example --extract-arabic',
    'Options: --tmdb, --title, --duration-ms, --ffprobe, --ffmpeg, --extract-arabic, --watch, --watch-interval-ms, --index, --rescan, --dry-run, --json',
  ].join('\n');
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`تم فحص: ${result.media.filename}`);
  console.log(`OpenSubtitles hash: ${result.media.videoHash}`);
  console.log(`الحجم: ${result.media.videoSize} بايت`);
  console.log(`مدة الفيديو: ${result.media.durationMs || 'غير متاحة'} ms`);
  console.log(`الإطارات: ${result.media.fps || 'غير متاحة'} fps`);
  console.log(`الصورة: ${result.media.resolution || 'غير متاحة'} · ${result.media.videoCodec || 'codec غير متاح'}`);
  console.log(`الصوت: ${result.media.audioCodec || 'غير متاح'} ${result.media.audioChannels || ''}`.trim());
  console.log(`مسارات الترجمة المدمجة: ${result.media.embeddedSubtitles.length}`);
  if (result.probe.warning) console.log(`ملاحظة ffprobe: ${result.probe.warning}`);
  if (result.registry) console.log('تم حفظ هوية النسخة في سجل الخادم.');
  if (result.extraction) console.log(`تم رفع ${result.extraction.uploads.length} ترجمة عربية من ${result.extraction.found} مسار.`);
}

function printDirectoryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`المجلد: ${result.directory}`);
  console.log(`المكتشف: ${result.discovered} · المفحوص: ${result.processed.length} · دون تغيير: ${result.skipped.length} · الفشل: ${result.failures.length}`);
  if (result.removed) console.log(`حُذف من الفهرس: ${result.removed}`);
  for (const failure of result.failures) console.log(`فشل ${failure.file}: ${failure.error}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  if (command === 'scan' && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage());
    return;
  }
  if (command !== 'scan') throw new Error(`Unsupported command: ${command || 'none'}\n\n${usage()}`);
  const { videoPath, options } = parseScanArgs(args);
  const stats = await fs.stat(videoPath);
  if (stats.isDirectory()) {
    if (!options.watch) {
      printDirectoryResult(await scanMediaDirectory(videoPath, options), options.json);
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(`بدأت مراقبة ${path.resolve(videoPath)} كل ${options.watchIntervalMs} ms`);
    try {
      await watchMediaDirectory(videoPath, options, {
        signal: controller.signal,
        onCycle: result => printDirectoryResult(result, options.json),
      });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
    return;
  }
  if (options.watch) throw new Error('--watch requires a directory path');
  printResult(await scanMedia(videoPath, options), options.json);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`فشل المساعد المحلي: ${displayError(error)}`);
    process.exitCode = 1;
  });
}
