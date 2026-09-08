import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditRecord, evaluatePrecisionGate, wilsonLowerBound } from '../v5/precisionGate.js';

function correctRecord(index) {
  return createAuditRecord({
    caseId: `case-${index}`,
    source: 'audited-regression',
    certified: true,
    audited: true,
    identity: true,
    language: true,
    timing: true,
    delivery: true,
    integrity: true,
  });
}

test('Wilson lower bound remains below observed precision and reaches >99% with 500 flawless audits', () => {
  assert.ok(wilsonLowerBound(500, 500) >= 0.99);
  assert.ok(wilsonLowerBound(500, 500) < 1);
});

test('V5 refuses a 99% claim when the audited certified sample is too small', () => {
  const gate = evaluatePrecisionGate(Array.from({ length: 100 }, (_, index) => correctRecord(index)));
  assert.equal(gate.observedPrecision, 1);
  assert.equal(gate.claimReady, false);
  assert.ok(gate.blockers.includes('need-500-audited-certified'));
});

test('V5 permits the 99% claim only after 500 flawless audited certified cases clear the 95% lower bound', () => {
  const gate = evaluatePrecisionGate(Array.from({ length: 500 }, (_, index) => correctRecord(index)));
  assert.equal(gate.auditedCertified, 500);
  assert.equal(gate.falseCertified, 0);
  assert.equal(gate.observedPrecision, 1);
  assert.ok(gate.lowerBound >= 0.99);
  assert.equal(gate.claimReady, true);
});

test('a single false certification in 500 blocks the 99% claim at 95% confidence', () => {
  const records = Array.from({ length: 500 }, (_, index) => correctRecord(index));
  records[499] = createAuditRecord({
    caseId: 'bad-timing',
    certified: true,
    audited: true,
    identity: true,
    language: true,
    timing: false,
    delivery: true,
    integrity: true,
  });
  const gate = evaluatePrecisionGate(records);
  assert.equal(gate.falseCertified, 1);
  assert.equal(gate.claimReady, false);
  assert.ok(gate.dimensions.timing.lowerBound < 0.99);
});

test('non-certified or unaudited cases cannot inflate the 99% precision sample', () => {
  const records = Array.from({ length: 500 }, (_, index) => correctRecord(index));
  records.push(createAuditRecord({ certified: false, audited: true, identity: true, language: true, timing: true, delivery: true, integrity: true }));
  records.push(createAuditRecord({ certified: true, audited: false, identity: true, language: true, timing: true, delivery: true, integrity: true }));
  const gate = evaluatePrecisionGate(records);
  assert.equal(gate.auditedCertified, 500);
  assert.equal(gate.claimReady, true);
});
