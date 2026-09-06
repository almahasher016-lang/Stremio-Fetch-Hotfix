import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPlan } from '../services/searchPlanner.js';
import { providerDefinitions } from '../providers/registry.js';
import { config } from '../config.js';

const providers = {
  exact: { name: 'exact', configured: () => true, supports: { movie: true, series: true, hash: true, reference: true } },
  fallback: { name: 'fallback', configured: () => true, supports: { movie: true, series: true, hash: false, reference: true } },
  movieOnly: { name: 'movieOnly', configured: () => true, supports: { movie: true, series: false, hash: false, reference: false } },
};

test('puts hash-capable providers in the exact-hash stage only', () => {
  const plan = createSearchPlan({ type: 'movie', id: 'tt1375666', videoHash: 'a1b2c3d4e5f60708', videoSize: 734003200, filename: 'Example.1080p.mkv' }, providers, Object.keys(providers));
  const hashStage = plan.find(stage => stage.name === 'exact-hash');
  assert.deepEqual(hashStage.providers, ['exact']);
  assert.equal(hashStage.variants[0].reason, 'exact-hash');
});

test('does not schedule movie-only providers for series requests', () => {
  const plan = createSearchPlan({ type: 'series', id: 'tt1375666:1:2', filename: 'Example.S01E02.1080p.mkv' }, providers, Object.keys(providers));
  for (const stage of plan) assert.equal(stage.providers.includes('movieOnly'), false);
});

test('does not let an unconfigured SubSource consume the YIFY fallback slot', () => {
  assert.equal(providerDefinitions.subsource.configured(), false);
  const plan = createSearchPlan(
    { type: 'movie', id: 'tt1375666' },
    providerDefinitions,
    config.providers.enabled,
    { maxProvidersPerStage: 3 },
  );
  const metadataStage = plan.find(stage => stage.name === 'exact-metadata');
  assert.ok(metadataStage);
  assert.deepEqual(metadataStage.providers, ['opensubtitles', 'subdl', 'yify']);
});

test('exact-hash stage uses hash identity without weaker filename or metadata constraints', () => {
  const plan = createSearchPlan({
    type: 'series',
    id: 'tt11198330:1:7',
    imdbId: 'tt11198330',
    season: 1,
    episode: 7,
    videoHash: 'f6bdfb5e54ea25bf',
    videoSize: 27228198074,
    filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.Remux.mkv',
  }, providers, Object.keys(providers));
  const item = plan.find(stage => stage.name === 'exact-hash').variants[0];
  assert.equal(item.videoHash, 'f6bdfb5e54ea25bf');
  assert.equal(item.videoSize, 27228198074);
  assert.equal(item.query, '');
  assert.equal(item.filename, '');
  assert.equal(item.imdbId, null);
  assert.equal(item.tmdbId, null);
  assert.equal(item.season, null);
  assert.equal(item.episode, null);
});
