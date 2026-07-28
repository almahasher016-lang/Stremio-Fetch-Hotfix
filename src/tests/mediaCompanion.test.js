import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateOpenSubtitlesHash,
  parseFrameRate,
  parseScanArgs,
  scanMediaDirectory,
  summarizeProbeOutput,
} from '../companion/mediaCompanion.js';

const MASK = (1n << 64n) - 1n;

function expectedHash(buffer) {
  let sum = BigInt(buffer.length);
  for (const position of [0, buffer.length - 65536]) {
    for (let offset = position; offset < position + 65536; offset += 8) sum = (sum + buffer.readBigUInt64LE(offset)) & MASK;
  }
  return sum.toString(16).padStart(16, '0');
}

test('calculates the OpenSubtitles 64-bit movie hash', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'm7md-hash-'));
  const videoPath = path.join(directory, 'sample.mkv');
  const content = Buffer.alloc(131072);
  for (let index = 0; index < content.length; index += 1) content[index] = index % 251;
  try {
    await fs.writeFile(videoPath, content);
    assert.equal(await calculateOpenSubtitlesHash(videoPath), expectedHash(content));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('parses a series scan command without losing inline option values', () => {
  const parsed = parseScanArgs(['D:\\Shows\\episode.mkv', '--server=https://example.com/addon', '--token=token=with=equals', '--imdb', 'tt1375666', '--type', 'series', '--season', '1', '--episode', '2', '--dry-run']);
  assert.equal(parsed.options.server, 'https://example.com/addon');
  assert.equal(parsed.options.token, 'token=with=equals');
  assert.equal(parsed.options.imdbId, 'tt1375666');
  assert.equal(parsed.options.season, 1);
  assert.equal(parsed.options.episode, 2);
  assert.equal(parsed.options.dryRun, true);
});

test('uses the built-in private token when a scan command omits one', () => {
  const parsed = parseScanArgs(['D:\\Movies\\movie.mkv', '--server', 'https://example.com', '--imdb', 'tt1375666', '--dry-run']);
  assert.ok(parsed.options.token.length > 0);
});

test('parses watch-first directory commands and bounded polling options', () => {
  const parsed = parseScanArgs([
    '--watch',
    'D:\\Media',
    '--server',
    'https://example.com',
    '--watch-interval-ms',
    '5000',
    '--index',
    'D:\\State\\media-index.json',
  ]);
  assert.equal(parsed.videoPath, 'D:\\Media');
  assert.equal(parsed.options.watch, true);
  assert.equal(parsed.options.watchIntervalMs, 5000);
  assert.match(parsed.options.indexPath, /media-index\.json$/i);
});

test('extracts deterministic frame-rate and stream identity from ffprobe output', () => {
  assert.equal(parseFrameRate('24000/1001'), 23.976);
  assert.equal(parseFrameRate('0/0'), null);
  const summary = summarizeProbeOutput({
    format: { duration: '7123.5', format_name: 'matroska,webm' },
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'hevc',
        profile: 'Main 10',
        width: 3840,
        height: 2160,
        pix_fmt: 'yuv420p10le',
        avg_frame_rate: '24000/1001',
        color_transfer: 'smpte2084',
      },
      {
        index: 1,
        codec_type: 'audio',
        codec_name: 'eac3',
        channels: 6,
        disposition: { default: 1 },
      },
      {
        index: 2,
        codec_type: 'subtitle',
        codec_name: 'subrip',
        tags: { language: 'ara', title: 'Arabic' },
      },
    ],
  });
  assert.equal(summary.durationMs, 7_123_500);
  assert.equal(summary.fps, 23.976);
  assert.equal(summary.resolution, '2160p');
  assert.equal(summary.videoCodec, 'hevc');
  assert.equal(summary.hdr, 'hdr10');
  assert.equal(summary.audioCodec, 'eac3');
  assert.equal(summary.audioChannels, '5.1');
  assert.equal(summary.container, 'matroska');
  assert.equal(summary.embeddedSubtitles[0].language, 'ara');
});

test('directory scan indexes successful files once and infers series episodes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'm7md-library-'));
  const nested = path.join(directory, 'Season 01');
  const moviePath = path.join(directory, 'Movie.2026.2160p.mkv');
  const episodePath = path.join(nested, 'Show.S01E02.1080p.WEB-DL.mkv');
  const calls = [];
  try {
    await fs.mkdir(nested, { recursive: true });
    await Promise.all([
      fs.writeFile(moviePath, 'movie'),
      fs.writeFile(episodePath, 'episode'),
      fs.writeFile(path.join(directory, 'ignore.txt'), 'not-video'),
    ]);
    const scanner = async (filePath, options) => {
      calls.push({ filePath, options });
      return {
        media: {
          type: options.type,
          season: options.season,
          episode: options.episode,
          videoHash: path.basename(filePath).includes('S01E02') ? '2222222222222222' : '1111111111111111',
          videoSize: (await fs.stat(filePath)).size,
          fps: 23.976,
          resolution: '1080p',
        },
      };
    };
    const options = {
      type: 'movie',
      token: 'secret-token-must-never-enter-the-index',
      dryRun: false,
    };
    const first = await scanMediaDirectory(directory, options, { scanMedia: scanner });
    assert.equal(first.discovered, 2);
    assert.equal(first.processed.length, 2);
    assert.equal(first.failures.length, 0);
    const episodeCall = calls.find(call => call.filePath === episodePath);
    assert.equal(episodeCall.options.type, 'series');
    assert.equal(episodeCall.options.season, 1);
    assert.equal(episodeCall.options.episode, 2);

    const second = await scanMediaDirectory(directory, options, { scanMedia: scanner });
    assert.equal(second.processed.length, 0);
    assert.equal(second.skipped.length, 2);
    assert.equal(calls.length, 2);
    const indexText = await fs.readFile(first.indexPath, 'utf8');
    assert.doesNotMatch(indexText, /secret-token/);
    assert.match(indexText, /Show\.S01E02/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
