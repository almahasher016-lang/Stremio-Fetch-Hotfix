import { msToTime, timeToMs } from './subtitleTiming.js';

const CUE_RE = /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function median(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function spreadIndexes(length, maxAnchors) {
  const count = Math.min(length, Math.max(4, maxAnchors));
  if (count < 4) return [];
  return Array.from({ length: count }, (_, index) => Math.round((index / (count - 1)) * (length - 1)));
}

function cueGap(cues, index, offset) {
  const current = cues[index];
  const other = cues[index + offset];
  if (!current || !other) return null;
  return offset > 0 ? other.start - current.end : current.start - other.end;
}

function localSignature(cues, index) {
  const values = [-2, -1, 1, 2]
    .map(offset => cueGap(cues, index, offset))
    .filter(value => Number.isFinite(value));
  const scale = Math.max(500, median(values.map(value => Math.abs(value))) || 1000);
  return values.map(value => clamp(value / scale, -10, 10));
}

function signatureDistance(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 2) return 1;
  let total = 0;
  for (let index = 0; index < length; index += 1) total += Math.abs(left[index] - right[index]);
  return clamp(total / length / 2.5, 0, 1);
}

function anchorCoverage(anchors, sourceLength, referenceLength) {
  if (anchors.length < 2) return 0;
  const sourceSpread = (anchors.at(-1).sourceIndex - anchors[0].sourceIndex) / Math.max(1, sourceLength - 1);
  const referenceSpread = (anchors.at(-1).referenceIndex - anchors[0].referenceIndex) / Math.max(1, referenceLength - 1);
  return Math.min(sourceSpread, referenceSpread);
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
  const indexes = spreadIndexes(Math.min(source.length, reference.length), maxAnchors);
  if (!indexes.length) return [];
  const anchors = [];
  const sourceLast = source.length - 1;
  const referenceLast = reference.length - 1;
  for (const index of indexes) {
    const ratio = indexes.length === 1 ? 0 : index / (indexes.length - 1);
    const sourceIndex = Math.round(ratio * sourceLast);
    const referenceIndex = Math.round(ratio * referenceLast);
    const sourceCue = source[sourceIndex];
    const referenceCue = reference[referenceIndex];
    if (!sourceCue || !referenceCue) continue;
    anchors.push({ sourceMs: sourceCue.start, referenceMs: referenceCue.start, sourceIndex, referenceIndex, agreement: 1 });
  }
  return anchors;
}

export function buildTemporalAnchors(sourceCues, referenceCues, maxAnchors = 48) {
  const source = Array.isArray(sourceCues) ? sourceCues : [];
  const reference = Array.isArray(referenceCues) ? referenceCues : [];
  const sourceIndexes = spreadIndexes(source.length, maxAnchors);
  if (!sourceIndexes.length || reference.length < 4) return [];
  const anchors = [];
  let lastReferenceIndex = -1;
  for (const sourceIndex of sourceIndexes) {
    const expected = Math.round((sourceIndex / Math.max(1, source.length - 1)) * (reference.length - 1));
    const radius = Math.max(3, Math.round(reference.length * 0.1));
    const sourceSignature = localSignature(source, sourceIndex);
    let best = null;
    for (let referenceIndex = Math.max(lastReferenceIndex + 1, expected - radius); referenceIndex <= Math.min(reference.length - 1, expected + radius); referenceIndex += 1) {
      const referenceSignature = localSignature(reference, referenceIndex);
      const temporalDistance = signatureDistance(sourceSignature, referenceSignature);
      const positionDistance = Math.abs((sourceIndex / Math.max(1, source.length - 1)) - (referenceIndex / Math.max(1, reference.length - 1)));
      const distance = temporalDistance * 0.78 + positionDistance * 0.22;
      if (!best || distance < best.distance) best = { referenceIndex, distance, temporalDistance };
    }
    if (!best || best.temporalDistance > 0.48) continue;
    const sourceCue = source[sourceIndex];
    const referenceCue = reference[best.referenceIndex];
    if (!sourceCue || !referenceCue) continue;
    anchors.push({
      sourceMs: sourceCue.start,
      referenceMs: referenceCue.start,
      sourceIndex,
      referenceIndex: best.referenceIndex,
      agreement: Number((1 - best.temporalDistance).toFixed(3)),
    });
    lastReferenceIndex = best.referenceIndex;
  }
  return anchors;
}

export function deriveLinearSyncFromAnchors(anchors = [], options = {}) {
  const safeAnchors = anchors.filter(anchor => Number.isFinite(anchor.sourceMs) && Number.isFinite(anchor.referenceMs));
  if (safeAnchors.length < 4) {
    return { enabled: false, ratio: 1, offsetMs: 0, confidence: 0, hints: ['reference:too-few-anchors'], anchors: safeAnchors.length };
  }
  const slopes = [];
  for (let index = 1; index < safeAnchors.length; index += 1) {
    const previous = safeAnchors[index - 1];
    const current = safeAnchors[index];
    const sourceDelta = current.sourceMs - previous.sourceMs;
    const referenceDelta = current.referenceMs - previous.referenceMs;
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
  const residualP90 = residuals.sort((left, right) => left - right)[Math.floor(residuals.length * 0.9)] || residualMedian;
  let confidence = 35 + clamp(safeAnchors.length, 0, 48);
  if (Math.abs(offsetMs) >= 250) confidence += 12;
  if (Math.abs(ratio - 1) >= 0.0015) confidence += 10;
  if (residualMedian < 1500) confidence += 18;
  else if (residualMedian < 3000) confidence += 10;
  else confidence -= 20;
  if (residualP90 > 8000) confidence -= 25;
  if (!plausibleRatio) confidence -= 20;
  confidence = clamp(Math.round(confidence), 0, 100);
  return {
    enabled: confidence >= Number(options.minConfidence ?? 72) && (Math.abs(offsetMs) >= 250 || Math.abs(ratio - 1) >= 0.0015),
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
    return { enabled: false, type: 'reference-piecewise', ratio: 1, offsetMs: 0, confidence: 0, hints: [`reference:not-enough-cues:${sourceCues.length}/${referenceCues.length}`], sourceCueCount: sourceCues.length, referenceCueCount: referenceCues.length };
  }
  const cueRatio = Math.min(sourceCues.length, referenceCues.length) / Math.max(sourceCues.length, referenceCues.length);
  if (cueRatio < Number(options.minCueRatio ?? 0.55)) {
    return { enabled: false, type: 'reference-piecewise', ratio: 1, offsetMs: 0, confidence: 0, hints: [`reference:cue-ratio-low:${cueRatio.toFixed(2)}`], sourceCueCount: sourceCues.length, referenceCueCount: referenceCues.length };
  }
  const temporalAnchors = buildTemporalAnchors(sourceCues, referenceCues, options.maxAnchors ?? 48);
  if (temporalAnchors.length < 4) {
    return {
      enabled: false,
      type: 'reference-piecewise',
      ratio: 1,
      offsetMs: 0,
      confidence: 0,
      hints: [`reference:insufficient-temporal-anchors:${temporalAnchors.length}`],
      sourceCueCount: sourceCues.length,
      referenceCueCount: referenceCues.length,
      cueRatio: Number(cueRatio.toFixed(3)),
    };
  }
  const plan = deriveLinearSyncFromAnchors(temporalAnchors, options);
  const agreement = temporalAnchors.reduce((sum, anchor) => sum + Number(anchor.agreement ?? 0), 0) / temporalAnchors.length;
  const coverage = anchorCoverage(temporalAnchors, sourceCues.length, referenceCues.length);
  const minAgreement = Number(options.minTemporalAgreement ?? 0.68);
  let confidence = plan.confidence;
  if (agreement >= 0.75) confidence += 8;
  else if (agreement < 0.58) confidence -= 24;
  if (coverage >= 0.65) confidence += 6;
  else if (coverage < Number(options.minAnchorCoverage ?? 0.45)) confidence -= 25;
  confidence = clamp(Math.round(confidence), 0, 100);
  const enabled = plan.enabled && agreement >= minAgreement && coverage >= Number(options.minAnchorCoverage ?? 0.45) && confidence >= Number(options.minConfidence ?? 72);
  return {
    ...plan,
    enabled,
    type: options.piecewise === false ? 'reference-linear' : 'reference-piecewise',
    confidence,
    hints: [...plan.hints, `reference:agreement:${agreement.toFixed(2)}`, `reference:minimumAgreement:${minAgreement.toFixed(2)}`, `reference:coverage:${coverage.toFixed(2)}`],
    sourceCueCount: sourceCues.length,
    referenceCueCount: referenceCues.length,
    cueRatio: Number(cueRatio.toFixed(3)),
    temporalAgreement: Number(agreement.toFixed(3)),
    anchorCoverage: Number(coverage.toFixed(3)),
    anchorPoints: enabled && options.piecewise !== false ? temporalAnchors.map(anchor => ({ sourceMs: anchor.sourceMs, referenceMs: anchor.referenceMs })) : [],
  };
}

export function explainReferencePlan(plan = {}) {
  if (!plan.enabled) return 'Reference sync disabled';
  return `Reference sync: ${msToTime(Math.abs(plan.offsetMs || 0))} offset, ratio ${Number(plan.ratio || 1).toFixed(6)}, confidence ${plan.confidence}`;
}
