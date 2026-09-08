import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';

function candidate(id, extra = {}) {
  return {
    id,
    provider: 'subdl',
    download: `https://example.com/${id}.srt`,
    score: 1000 - Number(id.replace(/\D/g, '') || 0),
    releaseMatch: {
      targetFields: 3,
      criticalMismatches: 0,
      tier: 4,
      priority: 40000,
      mismatched: [],
    },
    ...extra,
  };
}

function statusError(status) {
  const error = new Error(`Subtitle upstream failed with ${status}`);
  error.status = status;
  return error;
}

const noCacheWrite = async () => {};

test('remote candidate with stored valid quality is still checked for live delivery', async () => {
  let calls = 0;
  const item = candidate('remote-quality', { quality: { valid: true, score: 95, reasons: [] } });
  const result = await applyAccuracyPreflight([item], { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    cacheGetImpl: async () => null,
    cacheSetImpl: noCacheWrite,
    preflightImpl: async () => {
      calls += 1;
      throw statusError(404);
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, []);
});

test('legacy remote preflight cache without checkedAt is revalidated', async () => {
  let calls = 0;
  const result = await applyAccuracyPreflight([candidate('legacy-cache')], { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    cacheGetImpl: async () => ({ state: 'valid', quality: { valid: true, score: 80, reasons: [] } }),
    cacheSetImpl: noCacheWrite,
    preflightImpl: async () => {
      calls += 1;
      return { quality: { valid: true, score: 90, reasons: [] } };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result[0].accuracyPreflight.source, 'live-preflight');
  assert.ok(Number(result[0].accuracyPreflight.checkedAt) > 0);
});

test('fresh remote preflight cache avoids an immediate duplicate fetch', async () => {
  let calls = 0;
  const cached = {
    state: 'valid',
    quality: { valid: true, score: 91, reasons: [] },
    checkedAt: Date.now(),
  };
  const result = await applyAccuracyPreflight([candidate('fresh-cache')], { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    cacheGetImpl: async () => cached,
    cacheSetImpl: noCacheWrite,
    preflightImpl: async () => {
      calls += 1;
      throw new Error('should not fetch');
    },
  });

  assert.equal(calls, 0);
  assert.equal(result[0].accuracyPreflight.source, 'shared-cache');
});

test('personal vault valid quality remains a stable local shortcut', async () => {
  let calls = 0;
  const item = candidate('vault', {
    provider: 'vault',
    download: '/vault/subtitles/abc.srt',
    quality: { valid: true, score: 96, reasons: [] },
  });
  const result = await applyAccuracyPreflight([item], { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    cacheGetImpl: async () => null,
    cacheSetImpl: noCacheWrite,
    preflightImpl: async () => {
      calls += 1;
      throw new Error('vault should not use remote preflight');
    },
  });

  assert.equal(calls, 0);
  assert.equal(result[0].accuracyPreflight.source, 'existing-quality-local');
});

test('accuracy preflight checks all ten candidates that can be returned to Stremio', async () => {
  let calls = 0;
  const items = Array.from({ length: 10 }, (_, index) => candidate(`item-${index}`));
  const result = await applyAccuracyPreflight(items, { type: 'movie', filename: 'Movie.2026.BluRay.mkv' }, {
    cacheGetImpl: async () => null,
    cacheSetImpl: noCacheWrite,
    preflightImpl: async () => {
      calls += 1;
      return { quality: { valid: true, score: 90, reasons: [] } };
    },
  });

  assert.equal(calls, 10);
  assert.equal(result.length, 10);
  assert.ok(result.every(item => item.accuracyPreflight?.source === 'live-preflight'));
});
