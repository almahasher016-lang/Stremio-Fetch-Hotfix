import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const HASH_CHUNK_BYTES = 64 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 3 * 1024 * 1024;
const UINT64_MASK = (1n << 64n) - 1n;
const ARABIC_CODES = new Set(['ar', 'ara', 'arabic', 'arb', 'arq', 'ary', 'arz']);

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
    const streams = Array.isArray(output.streams) ? output.streams : [];
    const embeddedSubtitles = streams.filter(stream => stream.codec_type === 'subtitle').map(subtitleStream).filter(stream => Number.isInteger(stream.index));
    const durationMs = toDurationMs(output.format?.duration) || streams.map(stream => toDurationMs(stream.duration)).find(Boolean) || null;
    return { available: true, durationMs, embeddedSubtitles, warning: null };
  } catch (error) {
    return { available: false, durationMs: null, embeddedSubtitles: [], warning: displayError(error) };
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
  const [videoPath, ...tokens] = args;
  const options = { type: 'movie', ffprobe: 'ffprobe', ffmpeg: 'ffmpeg', token: defaultAdminToken(), extractArabic: false, dryRun: false, json: false };
  const aliases = {
    server: 'server', token: 'token', imdb: 'imdbId', 'imdb-id': 'imdbId', tmdb: 'tmdbId', 'tmdb-id': 'tmdbId',
    type: 'type', season: 'season', episode: 'episode', title: 'title', 'duration-ms': 'durationMs', ffprobe: 'ffprobe', ffmpeg: 'ffmpeg',
  };
  const flags = new Set(['extract-arabic', 'dry-run', 'json']);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equalsAt = token.indexOf('=');
    const rawName = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1);
    if (flags.has(rawName)) {
      if (inlineValue !== undefined) throw new Error(`--${rawName} does not accept a value`);
      options[rawName === 'extract-arabic' ? 'extractArabic' : rawName === 'dry-run' ? 'dryRun' : 'json'] = true;
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
    embeddedSubtitles: probe.embeddedSubtitles,
  };
  const result = { media, probe: { available: probe.available, warning: probe.warning }, registry: null, extraction: null };
  if (!normalizedOptions.dryRun) result.registry = await postJson(normalizedOptions.server, '/api/companion/media', media, normalizedOptions.token);
  if (normalizedOptions.extractArabic && normalizedOptions.dryRun) {
    result.extraction = { found: probe.embeddedSubtitles.filter(isArabicStream).length, uploads: [], failures: [], skipped: 'dry-run' };
  } else if (normalizedOptions.extractArabic) {
    if (!probe.available) throw new Error(`Arabic extraction needs ffprobe: ${probe.warning}`);
    result.extraction = await extractArabicStreams(videoPath, probe.embeddedSubtitles, normalizedOptions, media);
  }
  return result;
}

function usage() {
  return [
    'Usage:',
    '  npm run companion:scan -- "D:\\Video\\movie.mkv" --server https://your-addon.example --imdb tt1375666',
    '  npm run companion:scan -- "D:\\Video\\episode.mkv" --server https://your-addon.example --imdb tt11198330 --type series --season 1 --episode 1 --extract-arabic',
    'Options: --tmdb, --title, --duration-ms, --ffprobe, --ffmpeg, --extract-arabic, --dry-run, --json',
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
  console.log(`مسارات الترجمة المدمجة: ${result.media.embeddedSubtitles.length}`);
  if (result.probe.warning) console.log(`ملاحظة ffprobe: ${result.probe.warning}`);
  if (result.registry) console.log('تم حفظ هوية النسخة في سجل الخادم.');
  if (result.extraction) console.log(`تم رفع ${result.extraction.uploads.length} ترجمة عربية من ${result.extraction.found} مسار.`);
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
  const result = await scanMedia(videoPath, options);
  printResult(result, options.json);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`فشل المساعد المحلي: ${displayError(error)}`);
    process.exitCode = 1;
  });
}
