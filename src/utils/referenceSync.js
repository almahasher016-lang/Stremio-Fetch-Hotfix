import { msToTime, timeToMs } from './subtitleTiming.js';

const CUE_RE = /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g;

function median(values) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function parseCueTimes(text = '') {
  const cues = [];
  const input = String(text || '');
  let match;
  while ((match = CUE_RE.exec(input))) {
    const start = timeToMs(match[1]);
    const end = timeToMs(match[2]);
    if (start !== null && end !== null && end > start) cues.push({ start, end, mid: start + (end - start) / 2 });
  }
  return cues;
}

export function buildPositionalAnchors(sourceCues, referenceCues, maxAnchors = 48) {
  const source = Array.isArray(sourceCues) ? sourceCues : [];
  const reference = Array.isArray(referenceCues) ? referenceCues : [];
  const count = Math.min(source.length, reference.length, Math.max(4, maxAnchors));
  if (count < 4) return [];

  const anchors = [];
  const lastSource = source.length - 1;
  const lastReference = reference.length - 1;
  for (let i = 0; i < count; i += 1) {
    const ratio = count === 1 ? 0 : i / (count - 1);
    const sourceIndex = Math.round(ratio * lastSource);
    const referenceIndex = Math.round(ratio * lastReference);
    const s = source[sourceIndex];
    const r = reference[referenceIndex];
    if (!s || !r) continue;
    anchors.push({
      sourceMs: s.start,
      referenceMs: r.start,
      sourceIndex,
      referenceIndex,
    });
  }
  return anchors;
}

export function deriveLinearSyncFromAnchors(anchors = [], options = {}) {
  const safeAnchors = anchors.filter(a => Number.isFinite(a.sourceMs) && Number.isFinite(a.referenceMs));
  if (safeAnchors.length < 4) {
    return { enabled: false, ratio: 1, offsetMs: 0, confidence: 0, hints: ['reference:too-few-anchors'], anchors: safeAnchors.length };
  }

  const slopes = [];
  for (let i = 1; i < safeAnchors.length; i += 1) {
    const prev = safeAnchors[i - 1];
    const curr = safeAnchors[i];
    const sourceDelta = curr.sourceMs - prev.sourceMs;
    const referenceDelta = curr.referenceMs - prev.referenceMs;
    if (sourceDelta > 10_000 && referenceDelta > 10_000) slopes.push(referenceDelta / sourceDelta);
  }

  let ratio = median(slopes) || 1;
  if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;

  const plausibleRatio = ratio >= 0.92 && ratio <= 1.09;
  if (!plausibleRatio && !options.allowAggressiveStretch) ratio = 1;

  const offsets = safeAnchors.map(anchor => anchor.referenceMs - anchor.sourceMs * ratio);
  const offsetMs = Math.round(median(offsets));
  const residuals = safeAnchors.map(anchor => Math.abs((anchor.sourceMs * ratio + offsetMs) - anchor.referenceMs));
  const residualMedian = median(residuals);
  const residualP90 = residuals.sort((a, b) => a - b)[Math.floor(residuals.length * 0.9)] || residualMedian;

  let confidence = 35;
  confidence += clamp(safeAnchors.length, 0, 48);
  if (Math.abs(offsetMs) >= 250) confidence += 12;
  if (Math.abs(ratio - 1) >= 0.0015) confidence += 10;
  if (residualMedian < 1500) confidence += 18;
  else if (residualMedian < 3000) confidence += 10;
  else confidence -= 20;
  if (residualP90 > 8000) confidence -= 25;
  if (!plausibleRatio) confidence -= 20;
  confidence = clamp(Math.round(confidence), 0, 100);

  const enabled = confidence >= Number(options.minConfidence ?? 72) && (Math.abs(offsetMs) >= 250 || Math.abs(ratio - 1) >= 0.0015);
  return {
    enabled,
    type: 'reference-linear',
    ratio,
    offsetMs,
    confidence,
    hints: [
      `reference:anchors:${safeAnchors.length}`,
      `reference:medianResidual:${Math.round(residualMedian)}ms`,
      `reference:p90Residual:${Math.round(residualP90)}ms`,
    ],
    anchors: safeAnchors.length,
    residualMedianMs: Math.round(residualMedian),
    residualP90Ms: Math.round(residualP90),
  };
}

export function deriveReferenceSyncPlan(sourceText, referenceText, options = {}) {
  const sourceCues = parseCueTimes(sourceText);
  const referenceCues = parseCueTimes(referenceText);
  const minCues = Number(options.minCues ?? 8);
  if (sourceCues.length < minCues || referenceCues.length < minCues) {
    return {
      enabled: false,
      type: 'reference-linear',
      ratio: 1,
      offsetMs: 0,
      confidence: 0,
      hints: [`reference:not-enough-cues:${sourceCues.length}/${referenceCues.length}`],
      sourceCueCount: sourceCues.length,
      referenceCueCount: referenceCues.length,
    };
  }

  const cueRatio = Math.min(sourceCues.length, referenceCues.length) / Math.max(sourceCues.length, referenceCues.length);
  if (cueRatio < Number(options.minCueRatio ?? 0.55)) {
    return {
      enabled: false,
      type: 'reference-linear',
      ratio: 1,
      offsetMs: 0,
      confidence: 0,
      hints: [`reference:cue-ratio-low:${cueRatio.toFixed(2)}`],
      sourceCueCount: sourceCues.length,
      referenceCueCount: referenceCues.length,
    };
  }

  const anchors = buildPositionalAnchors(sourceCues, referenceCues, options.maxAnchors ?? 48);
  const plan = deriveLinearSyncFromAnchors(anchors, options);
  return {
    ...plan,
    sourceCueCount: sourceCues.length,
    referenceCueCount: referenceCues.length,
    cueRatio: Number(cueRatio.toFixed(3)),
  };
}

export function explainReferencePlan(plan = {}) {
  if (!plan.enabled) return 'Reference sync disabled';
  return `Reference sync: ${msToTime(Math.abs(plan.offsetMs || 0))} offset, ratio ${Number(plan.ratio || 1).toFixed(6)}, confidence ${plan.confidence}`;
}
