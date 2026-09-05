import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeAccurateSubtitles } from '../utils/accuracyFirst.js';

function releaseMatch({ tier, priority, criticalMismatches = 0, targetFields = 6 }) {
  return { tier, priority, criticalMismatches, targetFields };
}

test('accuracy-first keeps an exact video hash result first', () => {
  const ranked = prioritizeAccurateSubtitles([
    {
      provider: 'yify',
      score: 200,
      releaseMatch: releaseMatch({ tier: 1, priority: 9000, criticalMismatches: 2 }),
      scoreReasons: [{ reason: 'exact-video-hash-match', value: 1800 }],
    },
    {
      provider: 'opensubtitles',
      score: 2000,
      trusted: true,
      qualityScore: 100,
      releaseMatch: releaseMatch({ tier: 6, priority: 65000 }),
      scoreReasons: [],
    },
  ]);

  assert.equal(ranked[0].provider, 'yify');
});

test('accuracy-first puts an exact release ahead of a non-hash personal result', () => {
  const ranked = prioritizeAccurateSubtitles([
    {
      provider: 'vault',
      score: 2400,
      trusted: true,
      releaseMatch: releaseMatch({ tier: 1, priority: 7000, criticalMismatches: 2 }),
      scoreReasons: [],
    },
    {
      provider: 'yify',
      score: 500,
      releaseMatch: releaseMatch({ tier: 6, priority: 65000 }),
      scoreReasons: [],
    },
  ]);

  assert.equal(ranked[0].provider, 'yify');
});

test('accuracy-first rejects a known release conflict before provider popularity', () => {
  const ranked = prioritizeAccurateSubtitles([
    {
      provider: 'opensubtitles',
      score: 1800,
      trusted: true,
      downloads: 50000,
      releaseMatch: releaseMatch({ tier: 1, priority: 11000, criticalMismatches: 1 }),
      scoreReasons: [],
    },
    {
      provider: 'subsource',
      score: 420,
      releaseMatch: releaseMatch({ tier: 4, priority: 44000, criticalMismatches: 0 }),
      scoreReasons: [],
    },
  ]);

  assert.equal(ranked[0].provider, 'subsource');
});

test('accuracy-first uses verified subtitle quality after equal release accuracy', () => {
  const match = releaseMatch({ tier: 5, priority: 54000 });
  const ranked = prioritizeAccurateSubtitles([
    {
      provider: 'opensubtitles',
      score: 900,
      qualityScore: 55,
      releaseMatch: match,
      scoreReasons: [],
    },
    {
      provider: 'subdl',
      score: 700,
      quality: { valid: true, score: 92 },
      releaseMatch: match,
      scoreReasons: [],
    },
  ]);

  assert.equal(ranked[0].provider, 'subdl');
});
