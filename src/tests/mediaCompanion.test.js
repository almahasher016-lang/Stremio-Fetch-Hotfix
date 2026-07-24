import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateOpenSubtitlesHash, parseScanArgs } from '../companion/mediaCompanion.js';

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
