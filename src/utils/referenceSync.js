import { msToTime, timeToMs } from './subtitleTiming.js';

const CUE_RE = /(\d{2,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,3}:\d{2}:\d{2}[,.]\d{3})/g;

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

function sampleCueSequence(cues, maxCues) {
  const safeMax = Math.max(4, Math.floor(Number(maxCues) || 192));
  if (cues.length <= safeMax) return cues.map((cue, index) => ({ cue, index }));
  const indexes = Array.from(
    { length: safeMax },
    (_, index) => Math.round((index / (safeMax - 1)) * (cues.length - 1)),
  );
  return [...new Set(indexes)].map(index => ({ cue: cues[index], index }));
}

function sequenceScales(sequence) {
  const cues = sequence.map(item => item.cue);
  const durations = cues.map(cue => cue.end - cue.start).filter(value => value > 0);
  const intervals = cues.slice(1).map((cue, index) => cue.start - cues[index].start).filter(value => value > 0);
  const gaps = cues.slice(1).map((cue, index) => Math.abs(cue.start - cues[index].end)).filter(Number.isFinite);
  return {
    duration: Math.max(250, median(durations) || 1500),
    interval: Math.max(500, median(intervals) || 4000),
    gap: Math.max(250, median(gaps) || 1000),
  };
}

function positiveFeatureDistance(left, right) {
  const a = Math.log1p(Math.max(0, left));
  const b = Math.log1p(Math.max(0, right));
  return clamp(Math.abs(a - b) / 1.6, 0, 1);
}

function signedFeatureDistance(left, right) {
  return clamp(Math.abs(Math.asinh(left) - Math.asinh(right)) / 2.5, 0, 1);
}

function cueFeature(sequence, index, scales) {
  const current = sequence[index]?.cue;
  const previous = sequence[index - 1]?.cue;
  const next = sequence[index + 1]?.cue;
  if (!current) return null;
  return {
    duration: (current.end - current.start) / scales.duration,
    intervalBefore: previous ? (current.start - previous.start) / scales.interval : 1,
    intervalAfter: next ? (next.start - current.start) / scales.interval : 1,
    gapBefore: previous ? (current.start - previous.end) / scales.gap : 0,
    gapAfter: next ? (next.start - current.end) / scales.gap : 0,
  };
}

function dtwMatchCost(source, reference, sourceIndex, referenceIndex, sourceScales, referenceScales) {
  const left = cueFeature(source, sourceIndex, sourceScales);
  const right = cueFeature(reference, referenceIndex, referenceScales);
  if (!left || !right) return 1;
  const durationDistance = positiveFeatureDistance(left.duration, right.duration);
  const intervalBeforeDistance = positiveFeatureDistance(left.intervalBefore, right.intervalBefore);
  const intervalAfterDistance = positiveFeatureDistance(left.intervalAfter, right.intervalAfter);
  const gapBeforeDistance = signedFeatureDistance(left.gapBefore, right.gapBefore);
  const gapAfterDistance = signedFeatureDistance(left.gapAfter, right.gapAfter);
  const sourcePosition = sourceIndex / Math.max(1, source.length - 1);
  const referencePosition = referenceIndex / Math.max(1, reference.length - 1);
  const positionDistance = Math.abs(sourcePosition - referencePosition);

  const structuralDistance = durationDistance * 0.16
    + intervalBeforeDistance * 0.22
    + intervalAfterDistance * 0.22
    + gapBeforeDistance * 0.15
    + gapAfterDistance * 0.15
    + positionDistance * 0.10;
  return clamp(structuralDistance, 0, 1);
}

export function buildDtwAnchors(sourceCues, referenceCues, options = {}) {
  const sourceInput = Array.isArray(sourceCues) ? sourceCues : [];
  const referenceInput = Array.isArray(referenceCues) ? referenceCues : [];
  if (sourceInput.length < 4 || referenceInput.length < 4) return [];

  const maxCues = Number(options.maxCues ?? 192);
  const maxAnchors = Number(options.maxAnchors ?? 48);
  const bandRatio = clamp(Number(options.bandRatio ?? 0.18), 0.05, 0.5);
  const gapPenalty = clamp(Number(options.gapPenalty ?? 0.42), 0.1, 1);
  const maxMatchCost = clamp(Number(options.maxMatchCost ?? 0.52), 0.1, 0.9);
  const source = sampleCueSequence(sourceInput, maxCues);
  const reference = sampleCueSequence(referenceInput, maxCues);
  const sourceScales = sequenceScales(source);
  const referenceScales = sequenceScales(reference);
  const rows = source.length + 1;
  const columns = reference.length + 1;
  const band = Math.max(
    3,
    Math.abs(source.length - reference.length) + 2,
    Math.ceil(Math.max(source.length, reference.length) * bandRatio),
  );
  const costs = new Float64Array(rows * columns);
  const trace = new Uint8Array(rows * columns);
  costs.fill(Number.POSITIVE_INFINITY);
  costs[0] = 0;

  for (let sourceIndex = 1; sourceIndex <= Math.min(source.length, band); sourceIndex += 1) {
    costs[sourceIndex * columns] = sourceIndex * gapPenalty;
    trace[sourceIndex * columns] = 2;
  }
  for (let referenceIndex = 1; referenceIndex <= Math.min(reference.length, band); referenceIndex += 1) {
    costs[referenceIndex] = referenceIndex * gapPenalty;
    trace[referenceIndex] = 3;
  }

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const expectedReference = Math.round((sourceIndex / source.length) * reference.length);
    const firstReference = Math.max(1, expectedReference - band);
    const lastReference = Math.min(reference.length, expectedReference + band);
    for (let referenceIndex = firstReference; referenceIndex <= lastReference; referenceIndex += 1) {
      const position = sourceIndex * columns + referenceIndex;
      const localCost = dtwMatchCost(
        source,
        reference,
        sourceIndex - 1,
        referenceIndex - 1,
        sourceScales,
        referenceScales,
      );
      const diagonal = costs[(sourceIndex - 1) * columns + referenceIndex - 1] + localCost;
      const deleteSource = costs[(sourceIndex - 1) * columns + referenceIndex] + gapPenalty;
      const insertReference = costs[sourceIndex * columns + referenceIndex - 1] + gapPenalty;
      if (diagonal <= deleteSource && diagonal <= insertReference) {
        costs[position] = diagonal;
        trace[position] = 1;
      } else if (deleteSource <= insertReference) {
        costs[position] = deleteSource;
        trace[position] = 2;
      } else {
        costs[position] = insertReference;
        trace[position] = 3;
      }
    }
  }

  if (!Number.isFinite(costs[source.length * columns + reference.length])) return [];
  const matches = [];
  let sourceIndex = source.length;
  let referenceIndex = reference.length;
  while (sourceIndex > 0 || referenceIndex > 0) {
    const direction = trace[sourceIndex * columns + referenceIndex];
    if (direction === 1) {
      const localCost = dtwMatchCost(
        source,
        reference,
        sourceIndex - 1,
        referenceIndex - 1,
        sourceScales,
        referenceScales,
      );
      if (localCost <= maxMatchCost) {
        const sourceItem = source[sourceIndex - 1];
        const referenceItem = reference[referenceIndex - 1];
        matches.push({
          sourceMs: sourceItem.cue.start,
          referenceMs: referenceItem.cue.start,
          sourceIndex: sourceItem.index,
          referenceIndex: referenceItem.index,
          agreement: Number((1 - localCost).toFixed(3)),
        });
      }
      sourceIndex -= 1;
      referenceIndex -= 1;
    } else if (direction === 2) {
      sourceIndex -= 1;
    } else if (direction === 3) {
      referenceIndex -= 1;
    } else {
      return [];
    }
  }
  matches.reverse();
  if (matches.length <= maxAnchors) return matches;
  return spreadIndexes(matches.length, maxAnchors).map(index => matches[index]);
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

function removeIsolatedAnchorOutliers(anchors, plan) {
  if (anchors.length < 5) return anchors;
  const signedResiduals = anchors.map(anchor => (
    anchor.referenceMs - (anchor.sourceMs * plan.ratio + plan.offsetMs)
  ));
  return anchors.filter((_anchor, index) => {
    const neighbors = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      if (offset === 0) continue;
      const value = signedResiduals[index + offset];
      if (Number.isFinite(value)) neighbors.push(value);
    }
    if (neighbors.length < 2) return true;
    const localMedian = median(neighbors);
    const localDeviation = median(neighbors.map(value => Math.abs(value - localMedian)));
    const threshold = Math.max(2500, localDeviation * 4 + 500);
    return Math.abs(signedResiduals[index] - localMedian) <= threshold;
  });
}

function evaluateAnchorPlan(anchors, sourceCues, referenceCues, options, strategy) {
  if (anchors.length < 4) {
    return {
      enabled: false,
      type: strategy === 'dtw' ? 'reference-dtw-piecewise' : 'reference-piecewise',
      ratio: 1,
      offsetMs: 0,
      confidence: 0,
      hints: [`reference:insufficient-${strategy}-anchors:${anchors.length}`],
      anchors: anchors.length,
      temporalAgreement: 0,
      anchorCoverage: 0,
      anchorPoints: [],
      strategy,
    };
  }

  const initialPlan = deriveLinearSyncFromAnchors(anchors, options);
  const stableAnchors = removeIsolatedAnchorOutliers(anchors, initialPlan);
  const evaluatedAnchors = stableAnchors.length >= 4 ? stableAnchors : anchors;
  const plan = deriveLinearSyncFromAnchors(evaluatedAnchors, options);
  const agreement = evaluatedAnchors.reduce((sum, anchor) => sum + Number(anchor.agreement ?? 0), 0) / evaluatedAnchors.length;
  const coverage = anchorCoverage(evaluatedAnchors, sourceCues.length, referenceCues.length);
  const minAgreement = Number(options.minTemporalAgreement ?? 0.68);
  let confidence = plan.confidence;
  if (agreement >= 0.75) confidence += 8;
  else if (agreement < 0.58) confidence -= 24;
  if (coverage >= 0.65) confidence += 6;
  else if (coverage < Number(options.minAnchorCoverage ?? 0.45)) confidence -= 25;
  confidence = clamp(Math.round(confidence), 0, 100);
  const enabled = plan.enabled
    && agreement >= minAgreement
    && coverage >= Number(options.minAnchorCoverage ?? 0.45)
    && confidence >= Number(options.minConfidence ?? 72);
  const piecewise = options.piecewise !== false;

  return {
    ...plan,
    enabled,
    type: strategy === 'dtw'
      ? (piecewise ? 'reference-dtw-piecewise' : 'reference-dtw-linear')
      : (piecewise ? 'reference-piecewise' : 'reference-linear'),
    confidence,
    hints: [
      ...plan.hints,
      `reference:strategy:${strategy}`,
      `reference:outliers-removed:${anchors.length - evaluatedAnchors.length}`,
      `reference:agreement:${agreement.toFixed(2)}`,
      `reference:minimumAgreement:${minAgreement.toFixed(2)}`,
      `reference:coverage:${coverage.toFixed(2)}`,
    ],
    temporalAgreement: Number(agreement.toFixed(3)),
    anchorCoverage: Number(coverage.toFixed(3)),
    anchorPoints: enabled && piecewise
      ? evaluatedAnchors.map(anchor => ({ sourceMs: anchor.sourceMs, referenceMs: anchor.referenceMs }))
      : [],
    strategy,
  };
}

function candidateScore(candidate) {
  return Number(candidate.confidence || 0)
    + Number(candidate.temporalAgreement || 0) * 15
    + Number(candidate.anchorCoverage || 0) * 10
    - Math.min(20, Number(candidate.residualMedianMs || 0) / 500)
    + (candidate.enabled ? 1000 : 0);
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
  const candidates = [
    evaluateAnchorPlan(temporalAnchors, sourceCues, referenceCues, options, 'temporal'),
  ];
  if (options.dtwEnabled !== false) {
    const dtwAnchors = buildDtwAnchors(sourceCues, referenceCues, {
      maxCues: options.dtwMaxCues ?? 192,
      maxAnchors: options.maxAnchors ?? 48,
      bandRatio: options.dtwBandRatio ?? 0.18,
      gapPenalty: options.dtwGapPenalty ?? 0.42,
      maxMatchCost: options.dtwMaxMatchCost ?? 0.52,
    });
    candidates.push(evaluateAnchorPlan(dtwAnchors, sourceCues, referenceCues, options, 'dtw'));
  }

  const selected = candidates.reduce((best, candidate) => (
    candidateScore(candidate) > candidateScore(best) ? candidate : best
  ));
  return {
    ...selected,
    sourceCueCount: sourceCues.length,
    referenceCueCount: referenceCues.length,
    cueRatio: Number(cueRatio.toFixed(3)),
  };
}

export function explainReferencePlan(plan = {}) {
  if (!plan.enabled) return 'Reference sync disabled';
  return `Reference sync: ${msToTime(Math.abs(plan.offsetMs || 0))} offset, ratio ${Number(plan.ratio || 1).toFixed(6)}, confidence ${plan.confidence}`;
}
