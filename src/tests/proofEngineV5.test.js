import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSubtitleProof, PROOF_DECISION, rankByProof } from '../v5/proofEngine.js';

function certifiedFixture(overrides = {}) {
  return {
    identity: {
      mediaType: 'movie',
      catalogIdMatch: true,
      yearMatch: true,
      ...overrides.identity,
    },
    language: {
      detectedLanguage: 'arabic',
      arabicProbability: 0.999,
      ...overrides.language,
    },
    timing: {
      exactVideoHashReference: true,
      ...overrides.timing,
    },
    delivery: {
      reachable: true,
      fresh: true,
      ...overrides.delivery,
    },
    integrity: {
      valid: true,
      cueCount: 900,
      coverageRatio: 0.98,
      ...overrides.integrity,
    },
  };
}

test('V5 certifies only when every proof dimension clears the strict floor', () => {
  const proof = evaluateSubtitleProof(certifiedFixture());
  assert.equal(proof.decision, PROOF_DECISION.CERTIFIED);
  assert.equal(proof.certified, true);
  assert.ok(proof.proofFloor >= 0.995);
});

test('wrong episode is a hard reject even if every other dimension is perfect', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    identity: {
      mediaType: 'series',
      catalogIdMatch: true,
      seasonMatch: true,
      episodeMatch: false,
      conflicts: ['episode'],
    },
  }));
  assert.equal(proof.decision, PROOF_DECISION.REJECT);
  assert.ok(proof.hardFailures.some(item => item.reason === 'identity-conflict:episode'));
});

test('Persian subtitle is a hard reject even with exact timing and a live URL', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    language: {
      detectedLanguage: 'persian',
      arabicProbability: 0.999,
    },
  }));
  assert.equal(proof.decision, PROOF_DECISION.REJECT);
  assert.equal(proof.confidence.language, 0);
});

test('dead delivery cannot be rescued by a high legacy score', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    delivery: { terminalFailure: true },
  }));
  assert.equal(proof.decision, PROOF_DECISION.REJECT);
});

test('release-name evidence alone cannot pretend to be certified timing', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    timing: {
      exactVideoHashReference: false,
      releaseTier: 5,
      fpsMatch: true,
    },
  }));
  assert.equal(proof.decision, PROOF_DECISION.SAFE);
  assert.ok(proof.confidence.timing < 0.995);
});

test('three-source near-perfect timing consensus can reach certified timing without exact hash', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    timing: {
      exactVideoHashReference: false,
      releaseTier: 5,
      independentConsensusCount: 3,
      timelineSimilarity: 0.997,
    },
  }));
  assert.equal(proof.decision, PROOF_DECISION.CERTIFIED);
  assert.ok(proof.reasons.includes('timing:multi-source-consensus'));
});

test('two-source consensus remains safe rather than certified', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    timing: {
      exactVideoHashReference: false,
      releaseTier: 5,
      independentConsensusCount: 2,
      timelineSimilarity: 0.997,
    },
  }));
  assert.equal(proof.decision, PROOF_DECISION.SAFE);
  assert.ok(proof.confidence.timing < 0.995);
});

test('provider Arabic label alone is withheld from certified output', () => {
  const proof = evaluateSubtitleProof(certifiedFixture({
    language: {
      detectedLanguage: '',
      arabicProbability: 0,
      providerArabicCode: true,
    },
  }));
  assert.notEqual(proof.decision, PROOF_DECISION.CERTIFIED);
  assert.ok(proof.confidence.language < 0.98);
});

test('proof ranking is lexicographic: certified beats a larger legacy score', () => {
  const certified = { score: 100, proof: evaluateSubtitleProof(certifiedFixture()) };
  const recovery = {
    score: 5000,
    proof: evaluateSubtitleProof(certifiedFixture({
      timing: { exactVideoHashReference: false, releaseTier: 2 },
    })),
  };
  const ranked = [recovery, certified].sort(rankByProof);
  assert.equal(ranked[0], certified);
});
