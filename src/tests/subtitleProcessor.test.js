import test from 'node:test';
import assert from 'node:assert/strict';
import { processSubtitleBuffer, vttToSrt } from '../utils/subtitleProcessor.js';

test('vttToSrt converts WEBVTT timings', () => {
  const srt = vttToSrt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nمرحبا');
  assert.match(srt, /1\n00:00:01,000 --> 00:00:02,000\nمرحبا/);
});

test('processSubtitleBuffer removes HTML tags and normalizes SRT', () => {
  const input = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n<i>مرحبا</i>\n', 'utf8');
  const result = processSubtitleBuffer(input);
  assert.equal(result.encoding, 'utf-8');
  assert.match(result.text, /مرحبا/);
  assert.doesNotMatch(result.text, /<i>/);
});

test('processSubtitleBuffer decodes Windows-1256 Arabic bytes', () => {
  const input = Buffer.from([0x31,0x0a,0x30,0x30,0x3a,0x30,0x30,0x3a,0x30,0x31,0x2c,0x30,0x30,0x30,0x20,0x2d,0x2d,0x3e,0x20,0x30,0x30,0x3a,0x30,0x30,0x3a,0x30,0x32,0x2c,0x30,0x30,0x30,0x0a,0xe3,0xd1,0xcd,0xc8,0xc7]);
  const result = processSubtitleBuffer(input);
  assert.match(result.text, /مرحبا/);
});
