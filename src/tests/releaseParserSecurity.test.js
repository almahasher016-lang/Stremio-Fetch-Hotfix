import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease } from '../utils/releaseParser.js';
import { buildVideoIdentity } from '../utils/videoIdentity.js';

test('release parser bounds hostile bracket, suffix and dot inputs', () => {
  const hostile = `${'['.repeat(100_000)}Movie.2026${'.ar'.repeat(50_000)}${'.'.repeat(100_000)}.mkv`;
  const parsed = parseRelease(hostile);
  assert.ok(parsed.raw.length <= 1024);
  assert.ok(parsed.normalized.length <= 1024);
});

test('video title derivation stays bounded and linear for separator floods', () => {
  const filename = `Movie${' - '.repeat(100_000)}2026.1080p.WEB-DL-GROUP.mkv`;
  const identity = buildVideoIdentity({ type: 'movie', filename });
  assert.ok(identity.filename.length <= 1024);
  assert.ok(identity.title.length <= 1024);
});
