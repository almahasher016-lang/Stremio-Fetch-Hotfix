import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSubtitleQuality, parseSubtitleCues } from '../utils/subtitleQuality.js';

function time(value) {
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},000`;
}

function makeSrt(language = 'arabic') {
  return Array.from({ length: 12 }, (_, index) => {
    const start = index * 9000;
    const text = language === 'arabic' ? `هذه ترجمة عربية رقم ${index + 1} للفحص` : `English subtitle number ${index + 1} for checking`;
    return `${index + 1}\n${time(start)} --> ${time(start + 2500)}\n${text}\n`;
  }).join('\n');
}

test('recognizes a healthy Arabic SRT timeline', () => {
  const text = makeSrt();
  const quality = analyzeSubtitleQuality(text, { expectedDurationMs: 110000, minCues: 8, minArabicRatio: 0.18, minCoverageRatio: 0.55 });
  assert.equal(parseSubtitleCues(text).length, 12);
  assert.equal(quality.valid, true);
  assert.ok(quality.score >= 70);
  assert.ok(quality.arabicRatio > 0.5);
});

test('rejects a non-Arabic subtitle when Arabic is required', () => {
  const quality = analyzeSubtitleQuality(makeSrt('english'), { minCues: 8, minArabicRatio: 0.18 });
  assert.equal(quality.valid, false);
  assert.ok(quality.reasons.includes('low-arabic-ratio'));
});
