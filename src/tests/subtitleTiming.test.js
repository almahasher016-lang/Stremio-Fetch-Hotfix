import test from 'node:test';
import assert from 'node:assert/strict';
import { applySyncPlan, detectSyncPlan, fpsRatio, msToTime, parseSrtTimingLine, shiftSubtitleTiming, stretchSubtitleTiming, timeToMs } from '../utils/subtitleTiming.js';

const SAMPLE = `1\n00:00:10,000 --> 00:00:12,000\nمرحبا\n`;

test('time conversion roundtrip', () => {
  assert.equal(timeToMs('00:01:02,345'), 62345);
  assert.equal(msToTime(62345), '00:01:02,345');
});

test('time conversion supports long-form subtitles beyond 99 hours', () => {
  assert.equal(timeToMs('100:00:00,000'), 360_000_000);
  assert.equal(msToTime(360_000_000), '100:00:00,000');
});

test('time conversion accepts omitted hours and variable fractional precision', () => {
  assert.equal(timeToMs('01:02.5'), 62_500);
  assert.equal(timeToMs('0:01:02.123456'), 62_123);
  assert.equal(timeToMs('00:61.000'), null);
  assert.deepEqual(parseSrtTimingLine('01:02.5 --> 01:04.123456 align:start'), {
    startMs: 62_500,
    endMs: 64_123,
    start: '00:01:02,500',
    end: '00:01:04,123',
  });
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

test('detectSyncPlan rejects unverified fps-only correction', () => {
  const plan = detectSyncPlan({ subtitleRelease: { fps: 25 }, videoRelease: { fps: 23.976 } });
  assert.equal(plan.enabled, false);
  assert.equal(plan.ratio, 1);
  assert.equal(plan.confidence, 0);
  assert.ok(plan.hints.some(hint => hint.startsWith('fps-difference-unverified:')));
});

test('detectSyncPlan enables only an explicit manual offset', () => {
  const plan = detectSyncPlan({ extra: { subtitleOffsetMs: 1750 } });
  assert.equal(plan.enabled, true);
  assert.equal(plan.verified, true);
  assert.equal(plan.offsetMs, 1750);
  assert.equal(plan.ratio, 1);
});

test('applySyncPlan performs stretch and offset', () => {
  const synced = applySyncPlan(SAMPLE, { enabled: true, ratio: 2, offsetMs: 1000 });
  assert.match(synced, /00:00:21,000 --> 00:00:25,000/);
});
