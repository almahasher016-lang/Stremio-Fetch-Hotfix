import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFamily } from '../utils/timingCompatibility.js';

test('sourceFamily keeps WEB Remux in the WEB timing family', () => {
  assert.equal(sourceFamily('Movie.2026.2160p.AMZN.WEB.Remux.HEVC-GRP.mkv'), 'web');
  assert.equal(sourceFamily('Movie.2026.1080p.WEBMux-GRP.mkv'), 'web');
});

test('sourceFamily recognizes BluRay remux aliases', () => {
  assert.equal(sourceFamily('Movie.2026.2160p.BDRemux.DV.HDR-GRP.mkv'), 'bluray');
  assert.equal(sourceFamily('Movie.2026.1080p.BDMV-GRP.mkv'), 'bluray');
  assert.equal(sourceFamily('Movie.2026.2160p.BluRay.REMUX-GRP.mkv'), 'bluray');
});
