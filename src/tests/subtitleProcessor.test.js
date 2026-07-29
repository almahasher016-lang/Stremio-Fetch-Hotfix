import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyArabicSubtitleDirection,
  assToSrt,
  processSubtitleBuffer,
  vttToSrt,
} from '../utils/subtitleProcessor.js';

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
  assert.match(result.text, /\u2067مرحبا\u2069\n\u2067بك\u2069/);
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

test('processSubtitleBuffer isolates Arabic cue lines and keeps terminal punctuation on the RTL run', () => {
  const input = Buffer.from(`1
00:00:01,000 --> 00:00:02,000
مرحبا بالعالم.

2
00:00:03,000 --> 00:00:04,000
هل أنت بخير؟

3
00:00:05,000 --> 00:00:06,000
انتبه!

4
00:00:07,000 --> 00:00:08,000
الإصدار WEB-DL 3.4.0.
`);
  const result = processSubtitleBuffer(input);
  assert.match(result.text, /\u2067مرحبا بالعالم\.\u200F\u2069/);
  assert.match(result.text, /\u2067هل أنت بخير؟\u200F\u2069/);
  assert.match(result.text, /\u2067انتبه!\u200F\u2069/);
  assert.match(result.text, /\u2067الإصدار WEB-DL 3\.4\.0\.\u200F\u2069/);
});

test('Arabic direction normalization is deterministic and does not alter indexes, timings, or numeric dialogue', () => {
  const source = `1
00:00:01,000 --> 00:00:02,000
\u202Eمرحبا!\u202C

2
00:00:03,000 --> 00:00:04,000
1984
`;
  const once = applyArabicSubtitleDirection(source);
  const twice = applyArabicSubtitleDirection(once);
  assert.equal(twice, once);
  assert.match(once, /^1\n00:00:01,000 --> 00:00:02,000\n/u);
  assert.match(once, /\u2067مرحبا!\u200F\u2069/);
  assert.doesNotMatch(once, /[\u202A-\u202E]/u);
  assert.match(once, /2\n00:00:03,000 --> 00:00:04,000\n1984/u);
});

test('Arabic direction normalization leaves a Latin-dominant cue unchanged', () => {
  const source = `1
00:00:01,000 --> 00:00:02,000
WEB-DL release with مرحبا!
`;
  const result = applyArabicSubtitleDirection(source);
  assert.match(result, /WEB-DL release with مرحبا!/);
  assert.doesNotMatch(result, /[\u200F\u2067\u2069]/u);
});

test('Arabic direction normalization is exactly idempotent for a control-only cue', () => {
  const source = `1
00:00:01,000 --> 00:00:02,000
\u202B
`;
  const once = applyArabicSubtitleDirection(source);

  assert.equal(once, '1\n00:00:01,000 --> 00:00:02,000\n');
  assert.equal(applyArabicSubtitleDirection(once), once);
  assert.doesNotMatch(once, /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/u);
});

test('Arabic direction normalization removes trailing controls and whitespace deterministically', () => {
  const source = `1
00:00:01,000 --> 00:00:02,000
WEB-DL release with مرحبا! \u202C

2
00:00:03,000 --> 00:00:04,000
مرحبا! \u202C
`;
  const once = applyArabicSubtitleDirection(source);

  assert.equal(applyArabicSubtitleDirection(once), once);
  assert.match(once, /WEB-DL release with مرحبا!\n/u);
  assert.match(once, /\u2067مرحبا!\u200F\u2069/u);
  assert.doesNotMatch(once, /[\u202A-\u202E]| +$/mu);
});
