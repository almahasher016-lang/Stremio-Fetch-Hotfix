import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeArabicCueLine, stabilizeArabicSrt } from '../utils/arabicBidi.js';

const PREFIX = '\u200F\u2067\u200F';
const SUFFIX = '\u200F\u2069\u200F';

test('anchors Arabic punctuation and paired brackets from both sides', () => {
  const cases = [
    'مرحبا بالعالم.',
    '(مرحبا بالعالم.)',
    '[هل أنت بخير؟]',
    '{انتبه!}',
    '«هذا صحيح، أليس كذلك؟»',
    '— مرحبا...',
  ];
  for (const source of cases) {
    assert.equal(stabilizeArabicCueLine(source), `${PREFIX}${source}${SUFFIX}`);
  }
});

test('keeps mixed Latin runs inside the Arabic isolated paragraph', () => {
  const source = 'هل شاهدت (WEB-DL 1080p)؟';
  assert.equal(stabilizeArabicCueLine(source), `${PREFIX}${source}${SUFFIX}`);
});

test('is exactly idempotent and replaces legacy bidi controls', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n\u2067(مرحبا.)\u200F\u2069\n`;
  const once = stabilizeArabicSrt(source);
  assert.equal(stabilizeArabicSrt(once), once);
  assert.ok(once.includes(`${PREFIX}(مرحبا.)${SUFFIX}`));
});

test('does not alter indexes, timings, numeric dialogue, or Latin-dominant lines', () => {
  const source = `1\n00:00:01,000 --> 00:00:02,000\n1984\nWEB-DL release with مرحبا!\n`;
  assert.equal(stabilizeArabicSrt(source), source);
});
