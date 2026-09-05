import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeAccurateSubtitles } from '../utils/accuracyFirst.js';

function releaseMatch({ tier, priority, criticalMismatches = 0, targetFields = 6, mismatched = [] }) {
  return { tier, priority, criticalMismatches, targetFields, mismatched };
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

test('accuracy-first prefers the same BluRay timing family over a resolution-only WEB match', () => {
  const target = 'House.of.the.Dragon.S01E07.MULTI.VFI.2160p.UHD.BluRay.Remux.DV.HDR.TrueHD.Atmos.7.1.HEVC-HYPERION.mkv';
  const web2160 = 'House.of.the.Dragon.S01E07.2160p.WEB.H265-GLHF';
  const bluray720 = 'House.of.the.Dragon.S01E07.720p.BluRay.x264-BLOODY';
  const ranked = prioritizeAccurateSubtitles([
    {
      provider: 'opensubtitles',
      releaseName: web2160,
      score: 1500,
      releaseMatch: releaseMatch({
        tier: 1,
        priority: 13000,
        criticalMismatches: 2,
        mismatched: ['source', 'releaseGroup'],
      }),
      scoreReasons: [],
    },
    {
      provider: 'opensubtitles',
      releaseName: bluray720,
      score: 900,
      releaseMatch: releaseMatch({
        tier: 1,
        priority: 9000,
        criticalMismatches: 3,
        mismatched: ['quality', 'releaseGroup', 'codecFamily'],
      }),
      scoreReasons: [],
    },
  ], { filename: target });

  assert.equal(ranked[0].releaseName, bluray720);
});

test('accuracy-first never lets source-family similarity override a wrong episode', () => {
  const ranked = prioritizeAccurateSubtitles([
    {
      provider: 'opensubtitles',
      releaseName: 'Show.S01E08.1080p.BluRay-GRP',
      score: 2000,
      releaseMatch: releaseMatch({
        tier: 1,
        priority: 15000,
        criticalMismatches: 1,
        mismatched: ['episode'],
      }),
      scoreReasons: [],
    },
    {
      provider: 'subdl',
      releaseName: 'Show.S01E07.1080p.WEB-DL-GRP',
      score: 800,
      releaseMatch: releaseMatch({
        tier: 2,
        priority: 22000,
        criticalMismatches: 0,
        mismatched: [],
      }),
      scoreReasons: [],
    },
  ], { filename: 'Show.S01E07.2160p.BluRay.REMUX-GRP.mkv' });

  assert.equal(ranked[0].releaseName, 'Show.S01E07.1080p.WEB-DL-GRP');
});
