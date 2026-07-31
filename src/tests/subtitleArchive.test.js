import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { compress as compressXz } from '@napi-rs/lzma/xz';
import { detectArchiveFormat, extractSubtitlePayload } from '../utils/subtitleArchive.js';

const ARABIC_SRT = `1
00:00:01,000 --> 00:00:03,000
مرحباً بك

2
00:00:05,000 --> 00:00:07,000
هذه ترجمة عربية
`;

const ENGLISH_SRT = `1
00:00:01,000 --> 00:00:03,000
Hello there
`;

const ARABIC_ASS = `[Script Info]
Title: Arabic

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,مرحبا بك
`;

test('detectArchiveFormat uses file signatures instead of URL extensions', () => {
  assert.equal(detectArchiveFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip');
  assert.equal(detectArchiveFormat(Buffer.from([0x1f, 0x8b, 0x08])), 'gzip');
  assert.equal(detectArchiveFormat(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])), 'xz');
  assert.equal(detectArchiveFormat(Buffer.from(ARABIC_SRT)), null);
});

test('ZIP extraction chooses the strongest Arabic subtitle candidate', async () => {
  const archive = zipSync({
    'README.txt': strToU8('This package contains subtitle files.'),
    'Movie.English.srt': strToU8(ENGLISH_SRT),
    'Movie.Arabic.srt': strToU8(ARABIC_SRT),
    '__MACOSX/._Movie.Arabic.srt': strToU8(ARABIC_SRT),
  });
  const result = await extractSubtitlePayload(Buffer.from(archive), {
    sourceName: 'Movie.2026.1080p.zip',
    maxDecompressedBytes: 100_000,
    maxArchiveEntries: 10,
  });

  assert.equal(result.archive, 'zip');
  assert.equal(result.entryName, 'Movie.Arabic.srt');
  assert.equal(result.buffer.toString('utf8'), ARABIC_SRT);
});

test('ZIP extraction ignores absolute and traversal entry paths', async () => {
  const archive = zipSync({
    '../Escape.Arabic.srt': strToU8(ARABIC_SRT),
    '/Absolute.Arabic.srt': strToU8(ARABIC_SRT),
    'C:/Windows/Drive.Arabic.srt': strToU8(ARABIC_SRT),
    'safe/Movie.Arabic.srt': strToU8(ARABIC_SRT),
  });
  const result = await extractSubtitlePayload(Buffer.from(archive), {
    sourceName: 'Movie.2026.zip',
    maxDecompressedBytes: 100_000,
    maxArchiveEntries: 10,
  });

  assert.equal(result.entryName, 'Movie.Arabic.srt');
  assert.equal(result.buffer.toString('utf8'), ARABIC_SRT);
});

test('ZIP extraction recognizes ASS and SSA subtitle entries', async () => {
  for (const extension of ['ass', 'ssa']) {
    const entryName = `Movie.Arabic.${extension}`;
    const archive = zipSync({
      'README.txt': strToU8('No timed cues here.'),
      [entryName]: strToU8(ARABIC_ASS),
    });
    const result = await extractSubtitlePayload(Buffer.from(archive), {
      sourceName: 'Movie.2026.zip',
      maxDecompressedBytes: 100_000,
      maxArchiveEntries: 10,
    });
    assert.equal(result.entryName, entryName);
    assert.equal(result.buffer.toString('utf8'), ARABIC_ASS);
  }
});

test('GZIP extraction returns the subtitle and enforces the expansion limit', async () => {
  const archive = Buffer.from(gzipSync(strToU8(ARABIC_SRT)));
  const result = await extractSubtitlePayload(archive, {
    sourceName: 'Movie.Arabic.srt.gz',
    maxDecompressedBytes: 100_000,
  });

  assert.equal(result.archive, 'gzip');
  assert.equal(result.entryName, 'Movie.Arabic.srt');
  assert.equal(result.buffer.toString('utf8'), ARABIC_SRT);

  const oversized = Buffer.from(gzipSync(strToU8('x'.repeat(100_000))));
  await assert.rejects(
    extractSubtitlePayload(oversized, { maxDecompressedBytes: 50_000 }),
    error => error?.status === 413,
  );
});

test('XZ extraction returns the subtitle and enforces the expansion limit', async () => {
  const archive = await compressXz(strToU8(ARABIC_SRT));
  const result = await extractSubtitlePayload(archive, {
    sourceName: 'Movie.Arabic.srt.xz',
    maxDecompressedBytes: 100_000,
  });

  assert.equal(result.archive, 'xz');
  assert.equal(result.entryName, 'Movie.Arabic.srt');
  assert.equal(result.buffer.toString('utf8'), ARABIC_SRT);

  const oversized = await compressXz(strToU8('x'.repeat(100_000)));
  await assert.rejects(
    extractSubtitlePayload(oversized, { maxDecompressedBytes: 50_000 }),
    error => error?.status === 413,
  );
});

test('ZIP extraction rejects archives with too many entries', async () => {
  const archive = zipSync({
    'one.srt': strToU8(ARABIC_SRT),
    'two.srt': strToU8(ARABIC_SRT),
  });
  await assert.rejects(
    extractSubtitlePayload(Buffer.from(archive), {
      maxDecompressedBytes: 100_000,
      maxArchiveEntries: 1,
    }),
    error => error?.status === 413,
  );
});
