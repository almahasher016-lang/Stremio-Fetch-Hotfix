import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __availabilityKeySpecsForTests,
  revalidateAvailabilityLkg,
} from '../services/subtitleService.js';

test('final Arabic LKG has exact, release and catalog scopes without app-version coupling', () => {
  const specs = __availabilityKeySpecsForTests({
    type: 'series',
    id: 'tt11198330:1:7',
    season: 1,
    episode: 7,
    filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.mkv',
    videoHash: 'f6bdfb5e54ea25bf',
    videoSize: '27228198074',
  });
  assert.deepEqual(specs.map(item => item.kind), ['exact', 'release', 'catalog']);
  assert.ok(specs.every(item => item.key.startsWith('arabic-lkg:')));
  assert.ok(specs.every(item => !item.raw.includes('4.3.0')));
});

test('LKG fallback is freshly preflighted before V5 proof evaluation', async () => {
  const cached = [{
    id: 'os-123',
    provider: 'opensubtitles',
    download: '/downloads/opensubtitles/123.srt',
    quality: { valid: false },
  }];
  const search = { type: 'movie', imdbId: 'tt33612209', filename: 'Movie.2026.BluRay.REMUX.mkv' };
  let calls = 0;
  const result = await revalidateAvailabilityLkg(search, { hit: true, value: cached }, {
    preflight: async (items, receivedSearch) => {
      calls += 1;
      assert.equal(items, cached);
      assert.equal(receivedSearch, search);
      return items.map(item => ({
        ...item,
        quality: { valid: true, cueCount: 120, detectedLanguage: 'arabic' },
        accuracyPreflight: { state: 'valid', checkedAt: Date.now() },
      }));
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].quality.valid, true);
  assert.equal(result[0].accuracyPreflight.state, 'valid');
});

test('missing LKG never calls preflight', async () => {
  let calls = 0;
  const result = await revalidateAvailabilityLkg({}, null, {
    preflight: async () => {
      calls += 1;
      return [];
    },
  });
  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});
