import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDtwAnchors,
  buildPositionalAnchors,
  deriveLinearSyncFromAnchors,
  deriveReferenceSyncPlan,
  parseCueTimes,
} from '../utils/referenceSync.js';

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

test('deterministic DTW keeps the correct offset when one subtitle has an extra cue', () => {
  const sourceStarts = [10000, 14500, 23000, 35500, 41000, 59000, 68000, 80500, 97000, 110000];
  const referenceStarts = [...sourceStarts.map(start => start + 2300), 31700].sort((left, right) => left - right);
  const source = parseCueTimes(makeSrt(sourceStarts));
  const reference = parseCueTimes(makeSrt(referenceStarts));
  const anchors = buildDtwAnchors(source, reference, { maxAnchors: 48 });
  const closeMatches = anchors.filter(anchor => Math.abs((anchor.referenceMs - anchor.sourceMs) - 2300) <= 100);
  const plan = deriveLinearSyncFromAnchors(anchors, { minConfidence: 60 });

  assert.ok(closeMatches.length >= 8);
  assert.equal(plan.enabled, true);
  assert.equal(plan.offsetMs, 2300);
});

test('reference synchronization removes structural outliers before piecewise mapping', () => {
  const sourceStarts = [10000, 14500, 23000, 35500, 41000, 59000, 68000, 80500, 97000, 110000];
  const referenceStarts = [...sourceStarts.map(start => start + 2300), 31700].sort((left, right) => left - right);
  const plan = deriveReferenceSyncPlan(makeSrt(sourceStarts), makeSrt(referenceStarts), {
    minConfidence: 60,
    minCues: 4,
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.offsetMs, 2300);
  assert.ok(plan.hints.some(hint => /^reference:outliers-removed:[1-9]/.test(hint)));
  assert.ok(plan.anchorPoints.every(anchor => Math.abs((anchor.referenceMs - anchor.sourceMs) - 2300) <= 100));
});

test('outlier filtering preserves a sustained piecewise timeline change', () => {
  const sourceStarts = [10000, 15000, 23000, 34000, 49000, 58000, 70000, 85000, 97000, 115000, 128000, 146000];
  const referenceStarts = sourceStarts.map((start, index) => start + (index < 6 ? 2000 : 6000));
  const plan = deriveReferenceSyncPlan(makeSrt(sourceStarts), makeSrt(referenceStarts), {
    minConfidence: 60,
    minCues: 4,
  });
  const offsets = new Set(plan.anchorPoints.map(anchor => anchor.referenceMs - anchor.sourceMs));

  assert.equal(plan.enabled, true);
  assert.deepEqual([...offsets].sort((left, right) => left - right), [2000, 6000]);
  assert.ok(plan.hints.includes('reference:outliers-removed:0'));
});

test('deterministic synchronization rejects unrelated timelines', () => {
  const source = makeSrt([1000, 5000, 12000, 18000, 30000, 45000, 49000, 70000, 90000, 110000]);
  const reference = makeSrt([2000, 3000, 4000, 30000, 31000, 32000, 33000, 100000, 101000, 160000]);
  const plan = deriveReferenceSyncPlan(source, reference, { minConfidence: 72, minCues: 4 });
  assert.equal(plan.enabled, false);
});

test('deterministic synchronization does not alter an already aligned subtitle', () => {
  const starts = [10000, 14500, 23000, 35500, 41000, 59000, 68000, 80500];
  const text = makeSrt(starts);
  const plan = deriveReferenceSyncPlan(text, text, { minConfidence: 60, minCues: 4 });
  assert.equal(plan.enabled, false);
  assert.equal(plan.offsetMs, 0);
  assert.equal(plan.ratio, 1);
});
