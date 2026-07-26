import test from 'node:test';
import assert from 'node:assert/strict';
import { assToSrt, processSubtitleBuffer, vttToSrt } from '../utils/subtitleProcessor.js';

test('vttToSrt converts WEBVTT timings', () => {
  const srt = vttToSrt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nمرحبا');
  assert.match(srt, /1\n00:00:01,000 --> 00:00:02,000\nمرحبا/);
});

test('vttToSrt supports WebVTT timings without an hours field', () => {
  const srt = vttToSrt('WEBVTT\n\nSTYLE\n::cue { color: white; }\n\n00:01.250 --> 01:02.500 align:start\nمرحبا');
  assert.match(srt, /1\n00:00:01,250 --> 00:01:02,500\nمرحبا/);
  assert.doesNotMatch(srt, /align:/);
  assert.doesNotMatch(srt, /::cue/);
});

test('assToSrt converts ASS dialogue and removes styling overrides', () => {
  const input = `[Script Info]
Title: Arabic

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,{\\an8}<i>مرحبا</i>\\Nبك
`;
  const result = processSubtitleBuffer(Buffer.from(input));
  assert.equal(result.format, 'ass');
  assert.match(result.text, /00:00:01,250 --> 00:00:03,500/);
  assert.match(result.text, /مرحبا\nبك/);
  assert.doesNotMatch(result.text, /\\an8|<i>/);
  assert.match(assToSrt(input), /00:00:01,250 --> 00:00:03,500/);
});

test('processSubtitleBuffer removes HTML tags and normalizes SRT', () => {
  const input = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n<i>مرحبا</i>\n', 'utf8');
  const result = processSubtitleBuffer(input);
  assert.equal(result.encoding, 'utf-8');
  assert.match(result.text, /مرحبا/);
  assert.doesNotMatch(result.text, /<i>/);
});

test('processSubtitleBuffer preserves numeric-only dialogue lines', () => {
  const input = Buffer.from('12\n00:00:01,000 --> 00:00:02,000\n1984\n', 'utf8');
  const result = processSubtitleBuffer(input);
  assert.match(result.text, /1\n00:00:01,000 --> 00:00:02,000\n1984/);
});

test('processSubtitleBuffer decodes Windows-1256 Arabic bytes', () => {
  const input = Buffer.from([0x31,0x0a,0x30,0x30,0x3a,0x30,0x30,0x3a,0x30,0x31,0x2c,0x30,0x30,0x30,0x20,0x2d,0x2d,0x3e,0x20,0x30,0x30,0x3a,0x30,0x30,0x3a,0x30,0x32,0x2c,0x30,0x30,0x30,0x0a,0xe3,0xd1,0xcd,0xc8,0xc7]);
  const result = processSubtitleBuffer(input);
  assert.match(result.text, /مرحبا/);
});

test('processSubtitleBuffer detects UTF-16 LE and BE without a BOM', () => {
  const source = '1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n';
  const littleEndian = Buffer.from(source, 'utf16le');
  const bigEndian = Buffer.alloc(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1];
    bigEndian[index + 1] = littleEndian[index];
  }

  const leResult = processSubtitleBuffer(littleEndian);
  const beResult = processSubtitleBuffer(bigEndian);
  assert.equal(leResult.encoding, 'utf-16le');
  assert.equal(beResult.encoding, 'utf-16be');
  assert.match(leResult.text, /مرحبا/);
  assert.match(beResult.text, /مرحبا/);
});
