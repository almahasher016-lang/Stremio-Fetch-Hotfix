export const PROOF_DECISION = Object.freeze({
  CERTIFIED: 'certified',
  SAFE: 'safe',
  RECOVERY: 'recovery',
  WITHHOLD: 'withhold',
  REJECT: 'reject',
});

const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));
const bool = value => value === true;

function normalizeConflicts(value) {
  return Array.isArray(value) ? [...new Set(value.filter(Boolean).map(String))] : [];
}

function identityProof(evidence = {}) {
  const conflicts = normalizeConflicts(evidence.conflicts);
  if (conflicts.length) {
    return { confidence: 0, hardFail: true, reasons: conflicts.map(field => `identity-conflict:${field}`) };
  }
  if (bool(evidence.exactVideoHash)) {
    return { confidence: 1, hardFail: false, reasons: ['identity:exact-video-hash'] };
  }
  const series = evidence.mediaType === 'series';
  const catalog = bool(evidence.catalogIdMatch);
  const catalogSearch = bool(evidence.catalogSearchAnchored);
  const season = evidence.seasonMatch !== false && (bool(evidence.seasonMatch) || !series);
  const episode = evidence.episodeMatch !== false && (bool(evidence.episodeMatch) || !series);
  const year = evidence.yearMatch !== false;
  if (series && catalog && season && episode && year) {
    return { confidence: 0.999, hardFail: false, reasons: ['identity:catalog-season-episode'] };
  }
  if (!series && catalog && year) {
    return { confidence: 0.998, hardFail: false, reasons: ['identity:catalog'] };
  }
  // A provider's exact-metadata search does not override an explicit identity conflict.
  if (series && catalogSearch && bool(evidence.explicitEpisodeMatch) && year) {
    return { confidence: 0.997, hardFail: false, reasons: ['identity:catalog-search-episode'] };
  }
  if (!series && catalogSearch && year) {
    return { confidence: 0.997, hardFail: false, reasons: ['identity:catalog-search-anchored'] };
  }
  if (series && bool(evidence.explicitEpisodeMatch) && year) {
    return { confidence: 0.992, hardFail: false, reasons: ['identity:explicit-episode'] };
  }
  if (bool(evidence.titleMatch) && bool(evidence.yearMatch)) {
    return { confidence: 0.94, hardFail: false, reasons: ['identity:title-year-only'] };
  }
  return { confidence: 0.55, hardFail: false, reasons: ['identity:insufficient-proof'] };
}

function languageProof(evidence = {}) {
  const detected = String(evidence.detectedLanguage || '').toLowerCase();
  if (['persian', 'farsi', 'fa', 'fas', 'per'].includes(detected) || bool(evidence.wrongLanguage)) {
    return { confidence: 0, hardFail: true, reasons: ['language:wrong-language'] };
  }
  const probability = clamp01(evidence.arabicProbability);
  if (detected === 'arabic' && probability >= 0.995) {
    return { confidence: probability, hardFail: false, reasons: ['language:content-proven-arabic'] };
  }
  if (detected === 'arabic' && probability >= 0.98) {
    return { confidence: probability, hardFail: false, reasons: ['language:content-strong-arabic'] };
  }
  if (detected === 'arabic') {
    return { confidence: Math.max(0.95, probability), hardFail: false, reasons: ['language:content-arabic'] };
  }
  if (bool(evidence.providerArabicCode)) {
    return { confidence: 0.72, hardFail: false, reasons: ['language:provider-label-only'] };
  }
  return { confidence: 0.4, hardFail: false, reasons: ['language:unverified'] };
}

function timingProof(evidence = {}) {
  if (bool(evidence.conflict)) {
    return { confidence: 0, hardFail: true, reasons: ['timing:hard-conflict'] };
  }
  // Hashes, filenames, source families, FPS and consensus among subtitle mirrors describe
  // identity or candidate similarity. None measures dialogue-to-playback synchronization.
  // Never interpret absent/null residuals as zero (Number(null) === 0).
  const fields = [evidence.offsetMs, evidence.residualMedianMs, evidence.residualP90Ms, evidence.anchorCoverage];
  const hasMeasurements = fields.every(value => typeof value === 'number' && Number.isFinite(value));
  const measured = hasMeasurements && bool(evidence.measured)
    && bool(evidence.measuredExactVideoHash) && evidence.measuredVerdict === 'aligned'
    && evidence.residualMedianMs >= 0 && evidence.residualP90Ms >= 0
    && evidence.anchorCoverage >= 0.58;
  if (measured) {
    if (Math.abs(evidence.offsetMs) <= 300
      && evidence.residualMedianMs <= 200 && evidence.residualP90Ms <= 300) {
      return { confidence: 0.9999, hardFail: false, reasons: ['timing:measured-exact-reference-strict'] };
    }
    if (Math.abs(evidence.offsetMs) <= 1200
      && evidence.residualMedianMs <= 1200 && evidence.residualP90Ms <= 2500) {
      return { confidence: 0.965, hardFail: false, reasons: ['timing:measured-reference-compatible'] };
    }
  }
  return { confidence: 0.5, hardFail: false, reasons: ['timing:unverified'] };
}

function deliveryProof(evidence = {}) {
  if (bool(evidence.terminalFailure)) {
    return { confidence: 0, hardFail: true, reasons: ['delivery:terminal-failure'] };
  }
  if (bool(evidence.reachable) && bool(evidence.fresh)) {
    return { confidence: 0.9999, hardFail: false, reasons: ['delivery:fresh-live-check'] };
  }
  if (bool(evidence.reachable)) {
    return { confidence: 0.9, hardFail: false, reasons: ['delivery:stale-live-check'] };
  }
  return { confidence: 0.35, hardFail: false, reasons: ['delivery:unverified'] };
}

function integrityProof(evidence = {}) {
  if (evidence.valid === false || bool(evidence.parseFailure)) {
    return { confidence: 0, hardFail: true, reasons: ['integrity:invalid-subtitle'] };
  }
  const cueCount = Math.max(0, Number(evidence.cueCount) || 0);
  const coverage = evidence.coverageRatio == null ? null : Number(evidence.coverageRatio);
  const saneCoverage = coverage == null || (coverage >= 0.55 && coverage <= 1.15);
  if (bool(evidence.valid) && cueCount >= 80 && saneCoverage) {
    return { confidence: 0.999, hardFail: false, reasons: ['integrity:strong'] };
  }
  if (bool(evidence.valid) && cueCount >= 8 && saneCoverage) {
    return { confidence: 0.985, hardFail: false, reasons: ['integrity:valid'] };
  }
  return { confidence: 0.6, hardFail: false, reasons: ['integrity:unverified'] };
}

export function evaluateSubtitleProof(evidence = {}) {
  const dimensions = {
    identity: identityProof(evidence.identity),
    language: languageProof(evidence.language),
    timing: timingProof(evidence.timing),
    delivery: deliveryProof(evidence.delivery),
    integrity: integrityProof(evidence.integrity),
  };
  const hardFailures = Object.entries(dimensions)
    .filter(([, result]) => result.hardFail)
    .flatMap(([dimension, result]) => result.reasons.map(reason => ({ dimension, reason })));
  const confidence = Object.fromEntries(
    Object.entries(dimensions).map(([dimension, result]) => [dimension, Number(result.confidence.toFixed(4))]),
  );
  const floor = Math.min(...Object.values(confidence));
  const reasons = Object.values(dimensions).flatMap(result => result.reasons);
  let decision = PROOF_DECISION.WITHHOLD;
  if (hardFailures.length) {
    decision = PROOF_DECISION.REJECT;
  } else if (
    confidence.identity >= 0.995 && confidence.language >= 0.995
    && confidence.timing >= 0.995 && confidence.delivery >= 0.999
    && confidence.integrity >= 0.985
  ) {
    decision = PROOF_DECISION.CERTIFIED;
  } else if (
    confidence.identity >= 0.99 && confidence.language >= 0.98
    && confidence.timing >= 0.94 && confidence.delivery >= 0.99
    && confidence.integrity >= 0.98
  ) {
    decision = PROOF_DECISION.SAFE;
  } else if (
    confidence.identity >= 0.94 && confidence.language >= 0.95
    && confidence.delivery >= 0.9 && confidence.integrity >= 0.95
  ) {
    decision = PROOF_DECISION.RECOVERY;
  }
  return {
    decision,
    certified: decision === PROOF_DECISION.CERTIFIED,
    proofFloor: Number(floor.toFixed(4)),
    confidence,
    hardFailures,
    reasons,
  };
}

export function rankByProof(left, right) {
  const order = {
    [PROOF_DECISION.CERTIFIED]: 5,
    [PROOF_DECISION.SAFE]: 4,
    [PROOF_DECISION.RECOVERY]: 3,
    [PROOF_DECISION.WITHHOLD]: 2,
    [PROOF_DECISION.REJECT]: 1,
  };
  const decisionDelta = (order[right?.proof?.decision] || 0) - (order[left?.proof?.decision] || 0);
  if (decisionDelta) return decisionDelta;
  const floorDelta = (right?.proof?.proofFloor || 0) - (left?.proof?.proofFloor || 0);
  if (floorDelta) return floorDelta;
  return (right?.score || 0) - (left?.score || 0);
}
