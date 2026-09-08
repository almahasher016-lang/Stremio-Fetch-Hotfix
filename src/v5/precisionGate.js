const DIMENSIONS = Object.freeze(['identity', 'language', 'timing', 'delivery', 'integrity']);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function wilsonLowerBound(successes, total, z = 1.96) {
  const n = Math.max(0, Number(total) || 0);
  const k = Math.max(0, Math.min(n, Number(successes) || 0));
  if (!n) return 0;
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return clamp01((center - margin) / denominator);
}

function auditedCertified(records = []) {
  return records.filter(record => record?.certified === true && record?.audited === true);
}

function recordCorrect(record = {}) {
  return DIMENSIONS.every(dimension => record[dimension] === true);
}

export function evaluatePrecisionGate(records = [], {
  targetPrecision = 0.99,
  minimumAuditedCertified = 500,
  z = 1.96,
} = {}) {
  const audited = auditedCertified(records);
  const total = audited.length;
  const correct = audited.filter(recordCorrect).length;
  const falseCertified = total - correct;
  const overallObservedPrecision = total ? correct / total : 0;
  const overallLowerBound = wilsonLowerBound(correct, total, z);

  const dimensions = Object.fromEntries(DIMENSIONS.map(dimension => {
    const successes = audited.filter(record => record[dimension] === true).length;
    return [dimension, {
      successes,
      failures: total - successes,
      observedPrecision: total ? Number((successes / total).toFixed(6)) : 0,
      lowerBound: Number(wilsonLowerBound(successes, total, z).toFixed(6)),
    }];
  }));

  const enoughEvidence = total >= minimumAuditedCertified;
  const dimensionsPass = DIMENSIONS.every(dimension => dimensions[dimension].lowerBound >= targetPrecision);
  const overallPass = overallLowerBound >= targetPrecision;
  const claimReady = enoughEvidence && dimensionsPass && overallPass;

  const blockers = [];
  if (!enoughEvidence) blockers.push(`need-${minimumAuditedCertified}-audited-certified`);
  if (!overallPass) blockers.push('overall-lower-bound-below-target');
  for (const dimension of DIMENSIONS) {
    if (dimensions[dimension].lowerBound < targetPrecision) blockers.push(`${dimension}-lower-bound-below-target`);
  }

  return {
    claimReady,
    targetPrecision,
    confidenceLevel: z === 1.96 ? 0.95 : null,
    minimumAuditedCertified,
    auditedCertified: total,
    correctCertified: correct,
    falseCertified,
    observedPrecision: Number(overallObservedPrecision.toFixed(6)),
    lowerBound: Number(overallLowerBound.toFixed(6)),
    dimensions,
    blockers,
  };
}

export function createAuditRecord({
  certified = false,
  audited = false,
  identity = false,
  language = false,
  timing = false,
  delivery = false,
  integrity = false,
  caseId = null,
  source = null,
} = {}) {
  return {
    caseId,
    source,
    certified: certified === true,
    audited: audited === true,
    identity: identity === true,
    language: language === true,
    timing: timing === true,
    delivery: delivery === true,
    integrity: integrity === true,
  };
}

export { DIMENSIONS as V5_PRECISION_DIMENSIONS };
