import { createHash } from 'node:crypto';
import { timeToMs } from './subtitleTiming.js';

const TIME_RE = /(\d{2,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,3}:\d{2}:\d{2}[,.]\d{3})/;
const LETTER_RE = /[\p{L}\p{N}]/gu;
const ARABIC_LETTER_OR_NUMBER_RE = /\p{Script_Extensions=Arabic}/u;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function median(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function normalizedText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSubtitleCues(text = '') {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(line => TIME_RE.test(line));
    if (timeIndex < 0) continue;
    const match = lines[timeIndex].match(TIME_RE);
    const start = timeToMs(match?.[1]);
    const end = timeToMs(match?.[2]);
    if (start === null || end === null || end <= start) continue;
    const cueText = normalizedText(lines.slice(timeIndex + 1).join(' '));
    cues.push({ start, end, text: cueText, durationMs: end - start });
  }
  return cues;
}

export function temporalFingerprint(cues = [], maxPoints = 80) {
  if (!Array.isArray(cues) || cues.length < 2) return { hash: '', points: [], durationMs: 0 };
  const first = cues[0].start;
  const last = cues.at(-1).end;
  const duration = Math.max(1, last - first);
  const step = Math.max(1, Math.floor(cues.length / Math.max(2, maxPoints)));
  const points = [];
  for (let index = 0; index < cues.length; index += step) {
    const cue = cues[index];
    const previous = cues[index - 1];
    const position = Math.round(((cue.start - first) / duration) * 1000);
    const cueDuration = Math.round(clamp(cue.durationMs, 0, 15000) / 100);
    const gap = Math.round(clamp(previous ? cue.start - previous.end : 0, 0, 20000) / 100);
    points.push(`${position}:${cueDuration}:${gap}`);
    if (points.length >= maxPoints) break;
  }
  return {
    hash: createHash('sha256').update(points.join('|')).digest('hex').slice(0, 24),
    points,
    durationMs: duration,
  };
}

export function analyzeSubtitleQuality(text = '', {
  expectedDurationMs = null,
  minCues = 8,
  minArabicRatio = 0.18,
  minCoverageRatio = 0.55,
} = {}) {
  const cues = parseSubtitleCues(text);
  const allText = cues.map(cue => cue.text).join(' ');
  const letters = allText.match(LETTER_RE) || [];
  const arabicChars = letters.filter(character => ARABIC_LETTER_OR_NUMBER_RE.test(character));
  const arabicRatio = letters.length ? clamp(arabicChars.length / letters.length, 0, 1) : 0;
  const uniqueLines = new Set(cues.map(cue => cue.text.toLowerCase()).filter(Boolean));
  const duplicateRatio = cues.length ? 1 - (uniqueLines.size / cues.length) : 1;
  const cueDurationMs = cues.reduce((sum, cue) => sum + cue.durationMs, 0);
  const totalCharacters = cues.reduce((sum, cue) => sum + cue.text.length, 0);
  const averageCps = cueDurationMs ? totalCharacters / (cueDurationMs / 1000) : 0;
  const coverageRatio = expectedDurationMs && cues.length ? cues.at(-1).end / expectedDurationMs : null;
  const cueGaps = cues.slice(1).map((cue, index) => cue.start - cues[index].end).filter(gap => gap >= 0);
  const reasons = [];
  let score = 0;

  if (cues.length >= minCues) score += 24;
  else reasons.push('too-few-cues');
  if (cues.length >= 80) score += 12;
  if (arabicRatio >= minArabicRatio) score += 28;
  else reasons.push('low-arabic-ratio');
  if (averageCps >= 1.2 && averageCps <= 28) score += 16;
  else reasons.push('reading-speed-outlier');
  if (duplicateRatio <= 0.18) score += 10;
  else reasons.push('duplicate-cues');
  if (median(cueGaps) <= 8000) score += 5;
  else reasons.push('sparse-timeline');
  if (coverageRatio === null) score += 5;
  else if (coverageRatio >= minCoverageRatio && coverageRatio <= 1.15) score += 15;
  else reasons.push('coverage-outlier');

  const coverageValid = coverageRatio === null
    || (coverageRatio >= minCoverageRatio && coverageRatio <= 1.15);
  const valid = cues.length >= minCues && arabicRatio >= minArabicRatio && coverageValid;
  return {
    valid,
    score: Math.round(clamp(score, 0, 100)),
    reasons,
    cueCount: cues.length,
    startMs: cues[0]?.start || 0,
    endMs: cues.at(-1)?.end || 0,
    durationMs: cues.length ? cues.at(-1).end - cues[0].start : 0,
    coverageRatio: coverageRatio === null ? null : Number(coverageRatio.toFixed(3)),
    arabicRatio: Number(arabicRatio.toFixed(3)),
    duplicateRatio: Number(duplicateRatio.toFixed(3)),
    averageCps: Number(averageCps.toFixed(2)),
    fingerprint: temporalFingerprint(cues),
  };
}
