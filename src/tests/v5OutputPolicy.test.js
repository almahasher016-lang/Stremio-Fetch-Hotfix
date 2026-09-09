import test from 'node:test';
import assert from 'node:assert/strict';
import { selectV5FailureFallback, selectV5Output, v5ModeFromEnvironment } from '../v5/outputPolicy.js';

function entry(decision, id, cueCount = 900) {
  return {
    candidateId: id,
    item: { id, provider: 'test', accuracyPreflight: { quality: { cueCount } } },
    evidence: { marker: id },
    proof: { decision, proofFloor: decision === 'certified' ? 0.995 : 0.9 },
  };
}

test('V5 strict mode returns certified candidates only', () => {
  const output = selectV5Output([
    entry('certified', 'a'),
    entry('safe', 'b'),
    entry('recovery', 'c'),
    entry('withhold', 'd'),
    entry('reject', 'e'),
  ], { mode: 'strict', maxResults: 10 });
  assert.deepEqual(output.map(item => item.id), ['a']);
  assert.equal(output[0].v5Proof.decision, 'certified');
});

test('V5 balanced mode permits safe but never recovery, withhold or reject', () => {
  const output = selectV5Output([
    entry('certified', 'a'),
    entry('safe', 'b'),
    entry('recovery', 'c'),
    entry('withhold', 'd'),
    entry('reject', 'e'),
  ], { mode: 'balanced', maxResults: 10 });
  assert.deepEqual(output.map(item => item.id), ['a', 'b']);
});

test('V5 balanced mode rescues up to three complete recovery candidates when safe output is empty', () => {
  const output = selectV5Output([
    entry('recovery', 'best-recovery'),
    entry('recovery', 'second-recovery'),
    entry('recovery', 'third-recovery'),
    entry('recovery', 'fourth-recovery'),
    entry('withhold', 'withheld'),
    entry('reject', 'rejected'),
  ], { mode: 'balanced', maxResults: 10 });
  assert.deepEqual(output.map(item => item.id), ['best-recovery', 'second-recovery', 'third-recovery']);
  assert.ok(output.every(item => item.v5AvailabilityRescue === true));
});

test('V5 balanced rescue drops a short partial subtitle when full-length alternatives exist', () => {
  const output = selectV5Output([
    entry('recovery', 'special-look', 55),
    entry('recovery', 'full-film-a', 2124),
    entry('recovery', 'full-film-b', 2195),
  ], { mode: 'balanced', maxResults: 10 });
  assert.deepEqual(output.map(item => item.id), ['full-film-a', 'full-film-b']);
});

test('V5 balanced output drops a safe partial subtitle when a full safe subtitle exists', () => {
  const output = selectV5Output([
    entry('safe', 'full-film', 2195),
    entry('safe', 'special-look', 55),
    entry('recovery', 'full-recovery', 2124),
  ], { mode: 'balanced', maxResults: 10 });
  assert.deepEqual(output.map(item => item.id), ['full-film']);
});

test('V5 balanced rescue preserves genuinely short works when no full-length alternative exists', () => {
  const output = selectV5Output([
    entry('recovery', 'short-work-a', 55),
    entry('recovery', 'short-work-b', 61),
  ], { mode: 'balanced', maxResults: 10 });
  assert.deepEqual(output.map(item => item.id), ['short-work-a', 'short-work-b']);
});

test('V5 balanced mode never rescues withhold or reject candidates', () => {
  const output = selectV5Output([
    entry('withhold', 'withheld'),
    entry('reject', 'rejected'),
  ], { mode: 'balanced', maxResults: 10 });
  assert.deepEqual(output, []);
});

test('V5 recovery mode remains bounded and never emits withhold or reject', () => {
  const output = selectV5Output([
    entry('certified', 'a'),
    entry('safe', 'b'),
    entry('recovery', 'c'),
    entry('withhold', 'd'),
    entry('reject', 'e'),
  ], { mode: 'recovery', maxResults: 2 });
  assert.deepEqual(output.map(item => item.id), ['a', 'b']);
});

test('unknown V5 mode is disabled rather than silently weakening strictness', () => {
  assert.equal(v5ModeFromEnvironment({ RESOLVER_V5_MODE: 'strict' }), 'strict');
  assert.equal(v5ModeFromEnvironment({ RESOLVER_V5_MODE: 'balanced' }), 'balanced');
  assert.equal(v5ModeFromEnvironment({ RESOLVER_V5_MODE: 'recovery' }), 'recovery');
  assert.equal(v5ModeFromEnvironment({ RESOLVER_V5_MODE: 'anything-else' }), null);
});

test('V5 failure fallback preserves preflight survivors without leaking rejected or dead candidates', () => {
  const output = selectV5FailureFallback([
    { id: 'valid', accuracyPreflight: { state: 'valid' } },
    { id: 'unavailable', accuracyPreflight: { state: 'unavailable' } },
    { id: 'rejected', accuracyPreflight: { state: 'rejected' } },
    { id: 'dead', accuracyPreflight: { state: 'valid', deliveryFailure: true } },
  ]);
  assert.deepEqual(output.map(item => item.id), ['valid', 'unavailable']);
});

test('V5 failure fallback is defensive for invalid input', () => {
  assert.deepEqual(selectV5FailureFallback(null), []);
});
