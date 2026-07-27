import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSubtitleQuality, parseSubtitleCues } from '../utils/subtitleQuality.js';

function time(value) {
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},000`;
}

function makeSrt(language = 'arabic', cueCount = 12) {
  return Array.from({ length: cueCount }, (_, index) => {
    const start = index * 9000;
    const text = language === 'arabic' ? `هذه ترجمة عربية رقم ${index + 1} للفحص` : `English subtitle number ${index + 1} for checking`;
    return `${index + 1}\n${time(start)} --> ${time(start + 2500)}\n${text}\n`;
  }).join('\n');
}

function makeCoverageSrt(finalEndMs) {
  return Array.from({ length: 8 }, (_, index) => {
    const start = index * 12000;
    const end = index === 7 ? finalEndMs : start + 2500;
    return `${index + 1}\n${time(start)} --> ${time(end)}\n\u0647\u0630\u0647 \u062a\u0631\u062c\u0645\u0629 \u0639\u0631\u0628\u064a\u0629 \u0635\u062d\u064a\u062d\u0629 \u0631\u0642\u0645 ${index + 1}\n`;
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

test('caps the Arabic ratio at one when combining marks outnumber letters', () => {
  const markedArabic = Array.from({ length: 8 }, (_, index) => {
    const start = index * 3000;
    return `${index + 1}\n${time(start)} --> ${time(start + 2000)}\n\u0628\u064e\u064e\u064e\u064e\u064e\n`;
  }).join('\n');
  const quality = analyzeSubtitleQuality(markedArabic, { minCues: 8, minArabicRatio: 0.18 });

  assert.equal(quality.arabicRatio, 1);
  assert.ok(quality.arabicRatio <= 1);
  assert.equal(quality.valid, true);
});

test('requires the configured minimum cue count for validity', () => {
  const atMinimum = analyzeSubtitleQuality(makeSrt('arabic', 8), { minCues: 8, minArabicRatio: 0.18 });
  const belowMinimum = analyzeSubtitleQuality(makeSrt('arabic', 7), { minCues: 8, minArabicRatio: 0.18 });

  assert.equal(atMinimum.cueCount, 8);
  assert.equal(atMinimum.coverageRatio, null);
  assert.equal(atMinimum.valid, true);
  assert.equal(belowMinimum.cueCount, 7);
  assert.equal(belowMinimum.valid, false);
  assert.ok(belowMinimum.reasons.includes('too-few-cues'));
});

test('accepts coverage at 1.15 and rejects coverage above it', () => {
  const atBoundary = analyzeSubtitleQuality(makeCoverageSrt(115000), {
    expectedDurationMs: 100000,
    minCues: 8,
    minArabicRatio: 0.18,
    minCoverageRatio: 0.55,
  });
  const aboveBoundary = analyzeSubtitleQuality(makeCoverageSrt(116000), {
    expectedDurationMs: 100000,
    minCues: 8,
    minArabicRatio: 0.18,
    minCoverageRatio: 0.55,
  });

  assert.equal(atBoundary.coverageRatio, 1.15);
  assert.equal(atBoundary.valid, true);
  assert.equal(atBoundary.reasons.includes('coverage-outlier'), false);
  assert.equal(aboveBoundary.coverageRatio, 1.16);
  assert.equal(aboveBoundary.valid, false);
  assert.ok(aboveBoundary.reasons.includes('coverage-outlier'));
});

test('rejects coverage below the configured minimum', () => {
  const quality = analyzeSubtitleQuality(makeCoverageSrt(108000), {
    expectedDurationMs: 200000,
    minCues: 8,
    minArabicRatio: 0.18,
    minCoverageRatio: 0.55,
  });

  assert.equal(quality.coverageRatio, 0.54);
  assert.equal(quality.valid, false);
  assert.ok(quality.reasons.includes('coverage-outlier'));
});
