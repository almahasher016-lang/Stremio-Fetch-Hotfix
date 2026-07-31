import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { Unzip, UnzipInflate } from 'fflate';
import { Decompressor as XzDecompressor } from '@napi-rs/lzma/xz';
import { decodeSubtitleBuffer } from './subtitleProcessor.js';
import { httpError } from './httpError.js';

const gunzipAsync = promisify(gunzip);
const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa', 'txt']);
const TIMESTAMP_RE = /(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}\s*-->\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}/g;
const ASS_DIALOGUE_RE = /^\s*Dialogue\s*:\s*[^,\r\n]*,\d{1,3}:\d{2}:\d{2}\.\d{1,3},\d{1,3}:\d{2}:\d{2}\.\d{1,3},/gmi;
const ARABIC_RE = /[\u0600-\u06ff]/g;

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

export function detectArchiveFormat(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) return 'zip';
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gzip';
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  return null;
}

function unsafeArchivePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0')) return true;
  if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)) return true;
  return normalized.split('/').some(segment => segment === '..');
}

function safeEntryName(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 240) || '';
}

function extensionOf(value) {
  return safeEntryName(value).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

function normalizedAllowedExtensions(value) {
  if (value === undefined || value === null) return SUBTITLE_EXTENSIONS;
  const requested = Array.isArray(value) ? value : [value];
  return new Set(requested
    .map(extension => String(extension || '').trim().toLowerCase().replace(/^\./, ''))
    .filter(extension => SUBTITLE_EXTENSIONS.has(extension)));
}

function isSubtitleEntry(name, allowedExtensions = SUBTITLE_EXTENSIONS) {
  const normalized = String(name || '').replaceAll('\\', '/');
  if (unsafeArchivePath(normalized) || normalized.endsWith('/')) return false;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some(segment => segment === '__MACOSX' || segment.startsWith('.'))) return false;
  return allowedExtensions.has(extensionOf(normalized));
}

function scoreCandidate(candidate, sourceName = '') {
  const decoded = decodeSubtitleBuffer(candidate.buffer);
  const text = decoded.text || '';
  const timestamps = (text.match(TIMESTAMP_RE) || []).length + (text.match(ASS_DIALOGUE_RE) || []).length;
  if (!timestamps) return Number.NEGATIVE_INFINITY;

  const arabicCount = (text.match(ARABIC_RE) || []).length;
  const letters = (text.match(/\p{L}/gu) || []).length;
  const arabicRatio = arabicCount / Math.max(1, letters);
  const fileName = safeEntryName(candidate.name).toLowerCase();
  const source = safeEntryName(sourceName).toLowerCase();
  const extensionScore = { srt: 55, vtt: 45, ass: 42, ssa: 40, txt: 15 }[extensionOf(fileName)] || 0;
  const arabicName = /(?:^|[._\-\s])(ar|ara|arabic|arab)(?:[._\-\s]|$)|عرب|العرب/u.test(fileName);
  const englishName = /(?:^|[._\-\s])(en|eng|english)(?:[._\-\s]|$)/.test(fileName);
  const noiseName = /sample|readme|license|commentary|forced/.test(fileName);
  const sourceTokens = new Set(source.split(/[^a-z0-9]+/).filter(token => token.length >= 4));
  const sharedTokens = fileName.split(/[^a-z0-9]+/).filter(token => sourceTokens.has(token)).length;

  return extensionScore
    + Math.min(80, timestamps * 2)
    + Math.min(120, arabicCount / 2)
    + arabicRatio * 100
    + (arabicName ? 70 : 0)
    - (englishName ? 45 : 0)
    - (noiseName ? 80 : 0)
    + Math.min(30, sharedTokens * 6);
}

function extractZip(input, {
  maxDecompressedBytes,
  maxArchiveEntries,
  sourceName,
  allowedExtensions,
}) {
  const candidates = [];
  let entryCount = 0;
  let expandedBytes = 0;

  const unzipper = new Unzip(file => {
    entryCount += 1;
    if (entryCount > maxArchiveEntries) {
      throw httpError(413, `Subtitle archive has more than ${maxArchiveEntries} entries`);
    }

    if (!isSubtitleEntry(file.name, allowedExtensions)) {
      file.ondata = () => {};
      return;
    }
    if (![0, 8].includes(file.compression)) {
      file.ondata = () => {};
      return;
    }
    if (Number(file.originalSize) > maxDecompressedBytes) {
      throw httpError(413, 'Archived subtitle is too large');
    }

    const chunks = [];
    let entryBytes = 0;
    file.ondata = (error, data, final) => {
      if (error) throw httpError(422, `Invalid ZIP subtitle entry: ${safeEntryName(file.name)}`);
      const chunk = Buffer.from(data || []);
      entryBytes += chunk.length;
      expandedBytes += chunk.length;
      if (entryBytes > maxDecompressedBytes || expandedBytes > maxDecompressedBytes) {
        throw httpError(413, 'Expanded subtitle archive is too large');
      }
      if (chunk.length) chunks.push(chunk);
      if (final) candidates.push({ name: file.name, buffer: Buffer.concat(chunks, entryBytes) });
    };
    file.start();
  });
  unzipper.register(UnzipInflate);

  try {
    unzipper.push(input, true);
  } catch (error) {
    if (error?.status) throw error;
    throw httpError(422, 'Invalid or unsupported ZIP subtitle archive');
  }

  const ranked = candidates
    .map(candidate => ({ ...candidate, score: scoreCandidate(candidate, sourceName) }))
    .filter(candidate => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  if (!ranked.length) throw httpError(422, 'ZIP archive does not contain a supported subtitle file');

  return {
    buffer: ranked[0].buffer,
    archive: 'zip',
    entryName: safeEntryName(ranked[0].name),
  };
}

async function extractGzip(input, { maxDecompressedBytes, sourceName }) {
  try {
    const output = await gunzipAsync(input, { maxOutputLength: maxDecompressedBytes });
    return {
      buffer: Buffer.from(output),
      archive: 'gzip',
      entryName: safeEntryName(sourceName).replace(/\.gz$/i, '') || null,
    };
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE' || /larger than|too large|maxOutputLength/i.test(error?.message || '')) {
      throw httpError(413, 'Expanded GZIP subtitle is too large');
    }
    throw httpError(422, 'Invalid GZIP subtitle archive');
  }
}

async function extractXz(input, { maxDecompressedBytes, sourceName }) {
  const decompressor = new XzDecompressor();
  const chunks = [];
  let expandedBytes = 0;
  const append = chunk => {
    const output = Buffer.from(chunk || []);
    expandedBytes += output.length;
    if (expandedBytes > maxDecompressedBytes) throw httpError(413, 'Expanded XZ subtitle is too large');
    if (output.length) chunks.push(output);
  };

  try {
    const inputChunkSize = 16 * 1024;
    for (let offset = 0; offset < input.length; offset += inputChunkSize) {
      append(decompressor.update(input.subarray(offset, offset + inputChunkSize)));
    }
    append(await decompressor.finish());
  } catch (error) {
    if (error?.status) throw error;
    throw httpError(422, 'Invalid XZ subtitle archive');
  }

  return {
    buffer: Buffer.concat(chunks, expandedBytes),
    archive: 'xz',
    entryName: safeEntryName(sourceName).replace(/\.xz$/i, '') || null,
  };
}

export async function extractSubtitlePayload(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  const maxDecompressedBytes = Math.max(50_000, Number(options.maxDecompressedBytes) || 5_000_000);
  const maxArchiveEntries = Math.max(1, Number(options.maxArchiveEntries) || 32);
  const sourceName = options.sourceName || '';
  const allowedExtensions = normalizedAllowedExtensions(options.allowedExtensions);
  const archive = detectArchiveFormat(buffer);

  if (archive === 'zip') {
    return extractZip(buffer, { maxDecompressedBytes, maxArchiveEntries, sourceName, allowedExtensions });
  }
  if (archive === 'gzip') return extractGzip(buffer, { maxDecompressedBytes, sourceName });
  if (archive === 'xz') return extractXz(buffer, { maxDecompressedBytes, sourceName });
  return { buffer, archive: null, entryName: null };
}
