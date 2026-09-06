import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';

function candidate(id, extra = {}) {
  return {
    id,
    provider: 'yify',
    download: `https://example.com/${id}.srt`,
    score: 500,
    releaseMatch: { targetFields: 3, criticalMismatches: 0, tier: 4, priority: 100, mismatched: [] },
    ...extra,
  };
}

const noCache = {
  cacheGetImpl: async () => null,
  cacheSetImpl: async () => {},
};

test('accuracy preflight removes a definitely non-Arabic top candidate', async () => {
  const results = [candidate('bad'), candidate('good', { score: 490 })];
  const inspected = await applyAccuracyPreflight(results, { filename: 'Movie.2026.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async item => ({
      quality: item.id === 'bad'
        ? { valid: false, score: 40, reasons: ['low-arabic-ratio'] }
        : { valid: true, score: 90, reasons: [] },
    }),
  });
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].id, 'good');
  assert.equal(inspected[0].accuracyPreflight.state, 'valid');
});

test('accuracy preflight never removes a candidate merely because coverage is degraded', async () => {
  const exact = candidate('exact', {
    score: 400,
    scoreReasons: [{ reason: 'exact-video-hash-match', points: 900 }],
  });
  const other = candidate('other', { score: 900 });
  const inspected = await applyAccuracyPreflight([exact, other], { videoHash: 'abc', filename: 'Movie.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async item => ({
      quality: item.id === 'exact'
        ? { valid: false, score: 55, reasons: ['coverage-outlier'] }
        : { valid: true, score: 95, reasons: [] },
    }),
  });
  assert.equal(inspected[0].id, 'exact');
  assert.equal(inspected[0].accuracyPreflight.state, 'degraded');
});

test('unavailable preflight preserves deterministic ranking', async () => {
  const first = candidate('first', { score: 600 });
  const second = candidate('second', { score: 500 });
  const inspected = await applyAccuracyPreflight([first, second], {}, {
    ...noCache,
    preflightImpl: async () => { throw new Error('network unavailable'); },
  });
  assert.deepEqual(inspected.map(item => item.id), ['first', 'second']);
  assert.equal(inspected[0].accuracyPreflight.state, 'unavailable');
});

test('accuracy preflight fails open when every Arabic candidate is hard-rejected', async () => {
  const results = [candidate('first'), candidate('second', { score: 490 })];
  const inspected = await applyAccuracyPreflight(results, { filename: 'Movie.2026.BluRay.mkv' }, {
    ...noCache,
    preflightImpl: async () => ({ quality: { valid: false, score: 10, reasons: ['low-arabic-ratio'] } }),
  });
  assert.equal(inspected.length, 2);
  assert.equal(inspected[0].accuracyPreflightFallback, 'all-candidates-rejected');
});

