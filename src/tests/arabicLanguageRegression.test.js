import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { analyzeArabicScriptLanguage } from '../utils/arabicLanguageProfile.js';
import { isArabicLanguage } from '../utils/language.js';
import { analyzeSubtitleQuality } from '../utils/subtitleQuality.js';
import { extractSubtitlePayload } from '../utils/subtitleArchive.js';
import { subtitleDisplayName } from '../utils/stremio.js';

function timedSrt(line, count = 20) {
  const blocks = [];
  for (let index = 0; index < count; index += 1) {
    const start = String(index + 1).padStart(2, '0');
    const end = String(index + 2).padStart(2, '0');
    blocks.push((index + 1) + '\n00:00:' + start + ',000 --> 00:00:' + end + ',000\n' + line);
  }
  return blocks.join('\n\n');
}

const persianLine = 'این یک ترجمه فارسی است که برای این فیلم ساخته شده و باید درست نمایش داده شود ولی عربی نیست شما چرا این را می بینید';
const arabicLine = 'هذه ترجمة عربية لهذا الفيلم وأنا أريد أن تكون في التوقيت الصحيح ولكن يجب التحقق من النسخة قبل العرض';

test('Persian text is not accepted as Arabic just because it uses Arabic script', () => {
  const profile = analyzeArabicScriptLanguage((persianLine + ' ').repeat(20));
  assert.equal(profile.likelyPersian, true);
  assert.equal(profile.language, 'persian');
  assert.equal(isArabicLanguage('فارسی'), false);
  assert.equal(isArabicLanguage('fa'), false);
  assert.equal(isArabicLanguage('العربية'), true);
});

test('quality gate hard-invalidates a full Persian subtitle while preserving real Arabic', () => {
  const persian = analyzeSubtitleQuality(timedSrt(persianLine));
  const arabic = analyzeSubtitleQuality(timedSrt(arabicLine));
  assert.ok(persian.arabicRatio >= 0.9);
  assert.equal(persian.valid, false);
  assert.ok(persian.reasons.includes('wrong-language-persian'));
  assert.equal(persian.detectedLanguage, 'persian');
  assert.equal(arabic.valid, true);
  assert.notEqual(arabic.detectedLanguage, 'persian');
});

test('ZIP selection rejects a longer Persian subtitle and chooses the Arabic entry', async () => {
  const archive = zipSync({
    'Persian-long.srt': strToU8(timedSrt(persianLine, 40)),
    'Arabic.srt': strToU8(timedSrt(arabicLine, 20)),
  });
  const extracted = await extractSubtitlePayload(Buffer.from(archive), {
    maxDecompressedBytes: 1_000_000,
    maxArchiveEntries: 8,
    sourceName: 'Spider.Man.Brand.New.Day.2026.zip',
    context: { type: 'movie', filename: 'Spider.Man.Brand.New.Day.2026.4k.Th Rong.mkv', year: 2026 },
  });
  assert.equal(extracted.entryName, 'Arabic.srt');
});

test('Stremio quality badge separates text quality from timing confidence', () => {
  const name = subtitleDisplayName({
    provider: 'opensubtitles',
    quality: { score: 100 },
    releaseMatchTier: 0,
    score: 918,
    parsedRelease: { quality: '1080p', source: 'telesync' },
  });
  assert.match(name, /Text Q100/);
  assert.match(name, /Timing Unverified/);
});
