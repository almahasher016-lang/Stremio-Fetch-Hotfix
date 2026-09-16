import test from 'node:test';
import assert from 'node:assert/strict';
import { runV5Shadow } from '../v5/shadowResolver.js';

const token = 'test-secret-do-not-log';
const legacyUrlId = `subdl-/subtitle/123-456.zip?api_key=${token}`;

function candidate(id) {
  return {
    provider: 'subdl',
    id,
    imdbId: 'tt1234567',
    lang: 'ara',
    releaseName: 'Sample.2025.BluRay',
    quality: { valid: true, score: 100, cueCount: 20, arabicRatio: 1, detectedLanguage: 'arabic' },
    accuracyPreflight: { state: 'valid', checkedAt: Date.now(), source: 'live-preflight' },
  };
}

test('V5 telemetry hashes secret-bearing candidate IDs and preserves stable correlation', () => {
  const search = { type: 'movie', imdbId: 'tt1234567', filename: 'Sample.2025.BluRay.mkv' };
  const a = runV5Shadow([candidate(legacyUrlId)], search);
  const b = runV5Shadow([candidate(legacyUrlId)], search);
  const telemetry = JSON.stringify(a.summary);
  assert.ok(!telemetry.includes(token));
  assert.ok(!telemetry.includes('api_key='));
  assert.ok(!telemetry.includes(legacyUrlId));
  assert.match(a.summary.topCandidateId, /^sha256:[a-f0-9]{24}$/);
  assert.equal(a.summary.topCandidateId, a.summary.topCandidates[0].candidateId);
  assert.equal(a.summary.topCandidateId, a.summary.legacyTopCandidateId);
  assert.equal(a.summary.topCandidateId, b.summary.topCandidateId);
  assert.equal(a.evaluated[0].item.id, legacyUrlId);
});

test('V5 telemetry also hashes providerId and fileId when present', () => {
  const search = { type: 'movie', imdbId: 'tt1234567' };
  for (const field of ['providerId', 'fileId']) {
    const item = { ...candidate('public-id'), [field]: `secret?api_key=${token}` };
    const summary = runV5Shadow([item], search).summary;
    assert.ok(!JSON.stringify(summary).includes(token));
    assert.match(summary.topCandidateId, /^sha256:/);
  }
});
