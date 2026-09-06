import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightSubtitleCandidate } from '../utils/encodingProxy.js';

const ARABIC_SRT = `1\n00:00:01,000 --> 00:00:03,000\nمرحبا بكم في هذا الاختبار\n\n2\n00:00:04,000 --> 00:00:06,000\nهذه ترجمة عربية سليمة\n\n3\n00:00:07,000 --> 00:00:09,000\nنختبر جودة الملف هنا\n\n4\n00:00:10,000 --> 00:00:12,000\nالسطر الرابع للاختبار\n\n5\n00:00:13,000 --> 00:00:15,000\nالسطر الخامس للاختبار\n\n6\n00:00:16,000 --> 00:00:18,000\nالسطر السادس للاختبار\n\n7\n00:00:19,000 --> 00:00:21,000\nالسطر السابع للاختبار\n\n8\n00:00:22,000 --> 00:00:24,000\nالسطر الثامن للاختبار\n`;

test('preflight processes a candidate and returns content quality without serving it', async () => {
  const result = await preflightSubtitleCandidate({
    id: 'remote-1',
    provider: 'yify',
    download: 'https://example.com/subtitle.srt',
  }, {}, {
    fetcher: async () => Buffer.from(ARABIC_SRT, 'utf8'),
  });
  assert.equal(result.quality.valid, true);
  assert.ok(result.quality.arabicRatio > 0.5);
});
