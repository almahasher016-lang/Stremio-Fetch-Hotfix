import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPlan } from '../services/searchPlanner.js';

const providers = {
  hash: { name: 'hash', configured: () => true, supports: { movie: true, series: true, hash: true, reference: true } },
};

test('exact-hash lookup remains free of weaker metadata constraints', () => {
  const [stage] = createSearchPlan({
    type: 'series',
    imdbId: 'tt11198330',
    season: 1,
    episode: 7,
    year: 2022,
    filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.Remux.mkv',
    videoHash: 'f6bdfb5e54ea25bf',
    videoSize: 27228198074,
  }, providers, ['hash'], { language: 'ar' });
  assert.equal(stage.name, 'exact-hash');
  const variant = stage.variants[0];
  assert.equal(variant.videoHash, 'f6bdfb5e54ea25bf');
  assert.equal(variant.videoSize, 27228198074);
  assert.equal(variant.filename, '');
  assert.equal(variant.imdbId, null);
  assert.equal(variant.tmdbId, null);
  assert.equal(variant.season, null);
  assert.equal(variant.episode, null);
  assert.equal(variant.year, null);
});
