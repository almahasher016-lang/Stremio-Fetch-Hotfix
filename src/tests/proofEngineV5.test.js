import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSubtitleProof, PROOF_DECISION, rankByProof } from '../v5/proofEngine.js';

function certifiedFixture(overrides = {}) {
  return {
    identity: { mediaType: 'movie', catalogIdMatch: true, yearMatch: true, ...overrides.identity },
    language: { detectedLanguage: 'arabic', arabicProbability: 0.999, ...overrides.language },
    timing: {
      exactVideoHashReference: true,
      measured: true,
      measuredExactVideoHash: true,
      measuredVerdict: 'aligned',
      offsetMs: 100,
      residualMedianMs: 100,
      residualP90Ms: 200,
      anchorCoverage: 0.9,
      ...overrides.timing,
    },
    delivery: { reachable: true, fresh: true, ...overrides.delivery },
    integrity: { valid: true, cueCount: 900, coverageRatio: 0.98, ...overrides.integrity },
  };
}

test('V5 certifies only an exact-hash-reference measured timeline with strict residuals and all gates', () => {
  const proof = evaluateSubtitleProof(certifiedFixture());
  assert.equal(proof.decision, PROOF_DECISION.CERTIFIED);
  assert.equal(proof.certified, true);
  assert.ok(proof.proofFloor >= 0.995);
});

test('wrong episode is a hard reject despite perfect timing', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ identity: {
    mediaType: 'series', catalogIdMatch: true, seasonMatch: true, episodeMatch: false, conflicts: ['episode'],
  } }));
  assert.equal(proof.decision, PROOF_DECISION.REJECT);
  assert.ok(proof.hardFailures.some(item => item.reason === 'identity-conflict:episode'));
});

test('Persian is a hard reject with measured timing and a live URL', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ language: {
    detectedLanguage: 'persian', arabicProbability: 0.999,
  } }));
  assert.equal(proof.decision, PROOF_DECISION.REJECT);
  assert.equal(proof.confidence.language, 0);
});

test('dead delivery cannot be rescued by measured timing', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ delivery: { terminalFailure: true } }));
  assert.equal(proof.decision, PROOF_DECISION.REJECT);
});

test('release-family and exact hash metadata alone remain explicitly unverified', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ timing: {
    exactTimeline: false,
    exactVideoHashReference: true,
    releaseTier: 5,
    fpsMatch: true,
    measured: false,
  } }));
  assert.equal(proof.decision, PROOF_DECISION.RECOVERY);
  assert.ok(proof.reasons.includes('timing:unverified'));
});

test('three-source consensus with identical absolute bounds cannot certify without video timing', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ timing: {
    measured: false,
    releaseTier: 5,
    independentConsensusCount: 3,
    timelineSimilarity: 1,
    absoluteBoundsMatched: true,
  } }));
  assert.equal(proof.decision, PROOF_DECISION.RECOVERY);
  assert.ok(proof.confidence.timing < 0.94);
});

test('null, absent and nonfinite residuals cannot be interpreted as zero', () => {
  for (const missing of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const proof = evaluateSubtitleProof(certifiedFixture({ timing: { residualMedianMs: missing } }));
    assert.equal(proof.decision, PROOF_DECISION.RECOVERY);
  }
});

test('strict reference misses but measured-compatible evidence can be SAFE', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ timing: {
    offsetMs: 900, residualMedianMs: 800, residualP90Ms: 1800,
  } }));
  assert.equal(proof.decision, PROOF_DECISION.SAFE);
  assert.ok(proof.reasons.includes('timing:measured-reference-compatible'));
});

test('measured but drifting evidence remains unverified', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ timing: {
    offsetMs: 100, residualMedianMs: 2100, residualP90Ms: 4100,
  } }));
  assert.equal(proof.decision, PROOF_DECISION.RECOVERY);
});

test('provider Arabic label alone cannot be certified', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({ language: {
    detectedLanguage: '', arabicProbability: 0, providerArabicCode: true,
  } }));
  assert.notEqual(proof.decision, PROOF_DECISION.CERTIFIED);
  assert.ok(proof.confidence.language < 0.98);
});

test('proof ranking is lexicographic: measured certified beats larger legacy score', () => {
  const certified = { score: 100, proof: evaluateSubtitleProof(certifiedFixture()) };
  const recovery = { score: 5000, proof: evaluateSubtitleProof(certifiedFixture({ timing: { measured: false } })) };
  const ranked = [recovery, certified].sort(rankByProof);
  assert.equal(ranked[0], certified);
});
