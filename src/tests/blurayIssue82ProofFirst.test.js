import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { needsTimingDiscovery } from '../services/timingDiscovery.js';
import { evaluateV5Candidates, summarizeV5Evaluation } from '../v5/shadowResolver.js';

const fixture = JSON.parse(await readFile(new URL('../../regression/bluray-issue-82.json', import.meta.url), 'utf8'));
const NOW = 1_800_000_000_000;

function candidate(video, timing = null) {
  return {
    id: 'real-incident-simulated-unverified-provider-result',
    provider: 'opensubtitles',
    imdbId: video.imdbId,
    season: video.season,
    episode: video.episode,
    movieHash: video.videoHash,
    matchedByHash: true,
    releaseName: video.filename.replace(/\.mkv$/i, '.srt'),
    lang: 'ara',
    releaseMatchTier: 5,
    quality: {
      valid: true, score: 99, reasons: [], detectedLanguage: 'arabic',
      arabicRatio: 0.98, arabicWordHits: 600, persianWordHits: 0,
      persianDistinctiveRatio: 0, cueCount: 900, coverageRatio: 0.95,
    },
    accuracyPreflight: { state: 'valid', checkedAt: NOW },
    ...(timing ? { actualTimingEvidence: timing } : {}),
  };
}

function alignedTiming(overrides = {}) {
  return {
    measured: true, exactVideoHash: true, verdict: 'aligned',
    offsetMs: 100, residualMedianMs: 100, residualP90Ms: 180,
    anchorCoverage: 0.9,
    ...overrides,
  };
}

for (const incident of fixture.cases) {
  test(`issue #82 ${incident.id}: availability and exact metadata cannot certify or stop search`, () => {
    assert.equal(incident.expectedCorrectSubtitle, null, 'no invented ground truth');
    const search = incident.video;
    const raw = candidate(search);
    assert.equal(needsTimingDiscovery([raw], search), true, 'source-family and hash metadata must not stop search');
    const evaluated = evaluateV5Candidates([raw], search, { now: NOW });
    assert.equal(evaluated[0].proof.decision, 'recovery');
    assert.ok(evaluated[0].proof.reasons.includes('timing:unverified'));
    const summary = summarizeV5Evaluation(evaluated);
    assert.equal(summary.coverageOK, true);
    assert.equal(summary.releaseVerified, false);
    assert.equal(summary.counts.certified + summary.counts.safe, 0);
  });
  test(`issue #82 ${incident.id}: genuine measured strict timeline can end discovery`, () => {
    const search = incident.video;
    const raw = candidate(search, alignedTiming());
    assert.equal(needsTimingDiscovery([raw], search), false);
    assert.equal(evaluateV5Candidates([raw], search, { now: NOW })[0].proof.decision, 'certified');
  });
  test(`issue #82 ${incident.id}: null/drifting residuals cannot stop discovery or certify`, () => {
    for (const change of [{ residualMedianMs: null }, { residualP90Ms: 5000 }]) {
      const search = incident.video;
      const raw = candidate(search, alignedTiming(change));
      assert.equal(needsTimingDiscovery([raw], search), true);
      assert.equal(evaluateV5Candidates([raw], search, { now: NOW })[0].proof.decision, 'recovery');
    }
  });
}

test('unmeasured matching provider consensus is not release verification', () => {
  const search = fixture.cases[0].video;
  const raw = candidate(search);
  const evaluated = evaluateV5Candidates([
    { ...raw, provider: 'opensubtitles', id: 'one' },
    { ...raw, provider: 'subdl', id: 'two' },
    { ...raw, provider: 'subsource', id: 'three' },
  ], search, { now: NOW });
  assert.ok(evaluated.every(row => row.proof.decision === 'recovery'));
  assert.equal(summarizeV5Evaluation(evaluated).releaseVerified, false);
});
