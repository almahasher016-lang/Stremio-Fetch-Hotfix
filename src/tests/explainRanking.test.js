import test from 'node:test';
import assert from 'node:assert/strict';
import { explainSubtitleRanking } from '../utils/explainRanking.js';

test('ranking explanation exposes deterministic evidence for the first subtitle', () => {
  const rows = explainSubtitleRanking([{
    id: 'one',
    provider: 'opensubtitles',
    score: 900,
    scoreReasons: [{ reason: 'exact-video-hash-match', points: 900 }],
    releaseMatch: { tier: 5, priority: 120, criticalMismatches: 0, mismatched: [] },
    accuracyPreflight: { state: 'valid', quality: { valid: true, score: 95, reasons: [] } },
    trusted: true,
  }, {
    id: 'two',
    provider: 'yify',
    score: 700,
    releaseMatch: { tier: 4, priority: 90, criticalMismatches: 0, mismatched: [] },
  }], { filename: 'Movie.2026.BluRay.mkv', videoHash: 'abc' });

  assert.equal(rows[0].rank, 1);
  assert.ok(rows[0].evidence.labels.includes('exact-video-hash'));
  assert.ok(rows[0].evidence.labels.includes('content-preflight-valid'));
  assert.equal(rows[0].aheadOf.id, 'two');
  assert.equal(rows[0].search.videoHashPresent, true);
});
