import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeArabicCueLine, stabilizeArabicSrt } from '../utils/arabicBidi.js';

const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

test('preserves Arabic punctuation, brackets, quotes, and ellipsis exactly', () => {
  const cases = [
    'مرحبا بالعالم.',
    '(مرحبا بالعالم.)',
    '[هل أنت بخير؟]',
    '{انتبه!}',
    '«هذا صحيح، أليس كذلك؟»',
    '— مرحبا...',
    'هل شاهدت (WEB-DL 1080p)؟',
  ];
  for (const source of cases) {
    assert.equal(stabilizeArabicCueLine(source), source);
  }
});

test('removes upstream bidi controls without moving visible characters', () => {
  const source = '\u200F\u2067\u200F(مرحبا.)\u200F\u2069\u200F';
  assert.equal(stabilizeArabicCueLine(source), '(مرحبا.)');
});

test('is exactly idempotent and leaves no hidden direction controls', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n\u2067(مرحبا.)\u200F\u2069\n`;
  const once = stabilizeArabicSrt(source);
  assert.equal(stabilizeArabicSrt(once), once);
  assert.equal(once, '1\n00:00:01,000 --> 00:00:02,000\n(مرحبا.)\n');
  assert.doesNotMatch(once, BIDI_CONTROL_RE);
});

test('does not alter indexes, timings, numeric dialogue, or mixed Latin lines', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n1984\nWEB-DL release with مرحبا!\n`;
  assert.equal(stabilizeArabicSrt(source), source);
});
