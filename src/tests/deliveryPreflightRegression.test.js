import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';

function candidate(id, score = 500) {
  return {
    id,
    provider: 'subdl',
    download: `https://example.com/${id}.srt`,
    score,
    releaseMatch: {
      targetFields: 3,
      criticalMismatches: 0,
      tier: 4,
      priority: 40000,
      mismatched: [],
    },
  };
}

const noCache = {
  cacheGetImpl: async () => null,
  cacheSetImpl: async () => {},
};

function statusError(status) {
  const error = new Error(`Subtitle upstream failed with ${status}`);
  error.status = status;
  return error;
}

test('terminal 404 source is removed while a working fallback survives', async () => {
  const results = [candidate('dead', 700), candidate('good', 600)];
  const inspected = await applyAccuracyPreflight(results, { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async item => {
      if (item.id === 'dead') throw statusError(404);
      return { quality: { valid: true, score: 90, reasons: [] } };
    },
  });

  assert.deepEqual(inspected.map(item => item.id), ['good']);
});

test('terminal 403 source is not resurrected by fail-open', async () => {
  const inspected = await applyAccuracyPreflight([candidate('forbidden')], { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async () => { throw statusError(403); },
  });

  assert.deepEqual(inspected, []);
});

test('ordinary network outage still fails open because reachability is unknown', async () => {
  const inspected = await applyAccuracyPreflight([candidate('temporary')], { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async () => { throw new Error('network unavailable'); },
  });

  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].id, 'temporary');
  assert.equal(inspected[0].accuracyPreflight.state, 'unavailable');
});
