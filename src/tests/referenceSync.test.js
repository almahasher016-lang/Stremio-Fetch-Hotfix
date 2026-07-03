import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionalAnchors, deriveReferenceSyncPlan, parseCueTimes } from '../utils/referenceSync.js';

function makeSrt(times) {
  return times.map((start, index) => {
    const end = start + 1500;
    const fmt = ms => {
      const hh = Math.floor(ms / 3600000);
      const mm = Math.floor((ms % 3600000) / 60000);
      const ss = Math.floor((ms % 60000) / 1000);
      const mmm = ms % 1000;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(mmm).padStart(3, '0')}`;
    };
    return `${index + 1}\n${fmt(start)} --> ${fmt(end)}\nline ${index + 1}\n`;
  }).join('\n');
}

test('parseCueTimes extracts cue ranges', () => {
  const cues = parseCueTimes('1\n00:00:01,000 --> 00:00:02,000\nhello\n');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 1000);
});

test('buildPositionalAnchors maps cues by timeline position', () => {
  const source = parseCueTimes(makeSrt([1000, 5000, 9000, 13000, 17000]));
  const reference = parseCueTimes(makeSrt([3000, 7000, 11000, 15000, 19000]));
  const anchors = buildPositionalAnchors(source, reference, 5);
  assert.equal(anchors.length, 5);
  assert.equal(anchors[0].sourceMs, 1000);
  assert.equal(anchors[0].referenceMs, 3000);
});

test('deriveReferenceSyncPlan detects stable offset from reference subtitle', () => {
  const source = makeSrt([10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000]);
  const reference = makeSrt([12000, 22000, 32000, 42000, 52000, 62000, 72000, 82000]);
  const plan = deriveReferenceSyncPlan(source, reference, { minConfidence: 60, minCues: 4 });
  assert.equal(plan.enabled, true);
  assert.equal(plan.offsetMs, 2000);
  assert.ok(plan.confidence >= 60);
});

test('deriveReferenceSyncPlan rejects very different cue counts', () => {
  const source = makeSrt([10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000]);
  const reference = makeSrt([10000, 20000]);
  const plan = deriveReferenceSyncPlan(source, reference, { minCues: 4 });
  assert.equal(plan.enabled, false);
});
