import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeArabicCueLine, stabilizeArabicSrt } from '../utils/arabicBidi.js';

const RLM = '\u200F';
const UNSAFE_BIDI_RE = /[\u061C\u200E\u202A-\u202E\u2066-\u2069]/u;

test('anchors the terminal comma from the user-visible Stremio failure', () => {
  const source = 'ربما أنك حلمت بهذا الحدث،';
  assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
});

test('keeps internal Arabic punctuation untouched when the line ends with a letter', () => {
  const cases = [
    'نعم، منذ زمن بعيد، انتقلت',
    'أنا.. وبعض صديقاتي',
  ];
  for (const source of cases) assert.equal(stabilizeArabicCueLine(source), source);
});

test('anchors terminal punctuation, paired brackets, quotes, and ellipsis without moving visible text', () => {
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
    assert.equal(stabilizeArabicCueLine(source), `${source}${RLM}`);
  }
});

test('replaces upstream bidi controls with exactly one trailing RLM', () => {
  const source = '\u200F\u2067\u200F(مرحبا.)\u200F\u2069\u200F';
  assert.equal(stabilizeArabicCueLine(source), `(مرحبا.)${RLM}`);
});

test('is exactly idempotent and preserves indexes and timings', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n\u2067(مرحبا.)\u200F\u2069\n`;
  const once = stabilizeArabicSrt(source);
  assert.equal(stabilizeArabicSrt(once), once);
  assert.equal(once, `1\n00:00:01,000 --> 00:00:02,000\n(مرحبا.)${RLM}\n`);
  assert.doesNotMatch(once, UNSAFE_BIDI_RE);
  assert.equal((once.match(/\u200F/gu) || []).length, 1);
});

test('does not anchor numeric dialogue or a Latin-dominant mixed line', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n1984\nWEB-DL release with مرحبا!\n`;
  assert.equal(stabilizeArabicSrt(source), source);
});
