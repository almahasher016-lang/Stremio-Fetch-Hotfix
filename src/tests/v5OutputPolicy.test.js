import test from 'node:test';
import assert from 'node:assert/strict';
import { selectV5Output, v5ModeFromEnvironment } from '../v5/outputPolicy.js';

function entry(decision, id) {
  return {
    candidateId: id,
    item: { id, provider: 'test' },
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
