import test from 'node:test';
import assert from 'node:assert/strict';
import { applySyncPlan, detectSyncPlan, fpsRatio, msToTime, shiftSubtitleTiming, stretchSubtitleTiming, timeToMs } from '../utils/subtitleTiming.js';

const SAMPLE = `1\n00:00:10,000 --> 00:00:12,000\nمرحبا\n`;

test('time conversion roundtrip', () => {
  assert.equal(timeToMs('00:01:02,345'), 62345);
  assert.equal(msToTime(62345), '00:01:02,345');
});

test('shiftSubtitleTiming shifts all cues', () => {
  const shifted = shiftSubtitleTiming(SAMPLE, 2000);
  assert.match(shifted, /00:00:12,000 --> 00:00:14,000/);
});

test('stretchSubtitleTiming applies fps ratio', () => {
  const stretched = stretchSubtitleTiming(SAMPLE, 2);
  assert.match(stretched, /00:00:20,000 --> 00:00:24,000/);
});

test('fpsRatio supports PAL to film conversion', () => {
  assert.ok(Math.abs(fpsRatio(25, 23.976) - 1.0427) < 0.001);
});

test('detectSyncPlan enables confident fps correction', () => {
  const plan = detectSyncPlan({ subtitleRelease: { fps: 25 }, videoRelease: { fps: 23.976 } });
  assert.equal(plan.enabled, true);
  assert.ok(plan.confidence >= 70);
});

test('applySyncPlan performs stretch and offset', () => {
  const synced = applySyncPlan(SAMPLE, { enabled: true, ratio: 2, offsetMs: 1000 });
  assert.match(synced, /00:00:21,000 --> 00:00:25,000/);
});
