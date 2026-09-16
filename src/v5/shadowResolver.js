import { createHash } from 'node:crypto';
import { buildCandidateEvidence } from './candidateEvidence.js';
import { buildTimelineConsensus } from './consensusEngine.js';
import { evaluateSubtitleProof, rankByProof } from './proofEngine.js';

function stableCandidateId(item = {}, index = 0) {
  return String(item.providerId || item.fileId || item.id || `${item.provider || 'candidate'}:${index}`);
}

// Upstream IDs sometimes include credential-bearing URLs: hash them before logging.
function telemetryCandidateId(value) {
  if (value == null || value === '') return null;
  return `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

export function evaluateV5Candidates(results = [], search = {}, { now = Date.now() } = {}) {
  const consensus = buildTimelineConsensus(results);
  const evaluated = results.map((item, index) => {
    const evidence = buildCandidateEvidence(item, search, consensus.get(item) || {}, now);
    const timing = item.actualTimingEvidence || {};
    // A metadata hash or cross-provider timeline resemblance must not become cue timing proof.
    evidence.timing = {
      ...evidence.timing,
      measured: timing.measured === true,
      measuredExactVideoHash: timing.exactVideoHash === true,
      measuredVerdict: timing.verdict || null,
      offsetMs: timing.offsetMs ?? null,
      residualMedianMs: timing.residualMedianMs ?? null,
      residualP90Ms: timing.residualP90Ms ?? null,
      anchorCoverage: timing.anchorCoverage ?? null,
    };
    const proof = evaluateSubtitleProof(evidence);
    return {
      item,
      legacyRank: index,
      candidateId: stableCandidateId(item, index),
      evidence,
      proof,
    };
  });
  evaluated.sort((left, right) => rankByProof(
    { ...left.item, proof: left.proof },
    { ...right.item, proof: right.proof },
  ));
  return evaluated;
}

function timingTelemetry(evidence = {}) {
  return {
    exactTimeline: evidence.exactTimeline === true,
    exactVideoHashReference: evidence.exactVideoHashReference === true,
    measured: evidence.measured === true,
    measuredVerdict: evidence.measuredVerdict || null,
    offsetMs: evidence.offsetMs ?? null,
    residualMedianMs: evidence.residualMedianMs ?? null,
    residualP90Ms: evidence.residualP90Ms ?? null,
    anchorCoverage: evidence.anchorCoverage ?? null,
    stableReleaseFamily: evidence.stableReleaseFamily === true,
    compatibility: evidence.compatibility || 'unknown',
    timingFamilyTier: Number(evidence.timingFamilyTier || 0),
    legacyReleaseTier: Number(evidence.legacyReleaseTier || 0),
    sourceMatch: evidence.sourceMatch ?? null,
    sourceFamily: evidence.sourceFamily || null,
    targetSourceFamily: evidence.targetSourceFamily || null,
    sourceDetailMatch: evidence.sourceDetailMatch ?? null,
    serviceMatch: evidence.serviceMatch ?? null,
    releaseGroupMatch: evidence.releaseGroupMatch ?? null,
    editionMatch: evidence.editionMatch ?? null,
    fpsMatch: evidence.fpsMatch === true,
    durationMatch: evidence.durationMatch ?? null,
    durationDeltaMs: evidence.durationDeltaMs ?? null,
    hardConflicts: Array.isArray(evidence.hardConflicts) ? evidence.hardConflicts : [],
    formatDifferences: evidence.formatDifferences || {},
    independentConsensusCount: Number(evidence.independentConsensusCount || 0),
    timelineSimilarity: Number(evidence.timelineSimilarity || 0),
    absoluteBoundsMatched: evidence.absoluteBoundsMatched === true,
  };
}

export function summarizeV5Evaluation(evaluated = []) {
  const counts = { certified: 0, safe: 0, recovery: 0, withhold: 0, reject: 0 };
  for (const entry of evaluated) {
    const decision = entry?.proof?.decision;
    if (decision in counts) counts[decision] += 1;
  }
  const legacyTop = evaluated.find(entry => entry.legacyRank === 0) || null;
  const v5Top = evaluated[0] || null;
  const legacyTopDecision = legacyTop?.proof?.decision || null;
  const topCandidates = evaluated.slice(0, 5).map(entry => {
    const item = entry?.item || {};
    const quality = item.accuracyPreflight?.quality || item.quality || {};
    return {
      candidateId: telemetryCandidateId(entry?.candidateId),
      provider: item.originalProvider || item.provider || null,
      decision: entry?.proof?.decision || null,
      preflightState: item.accuracyPreflight?.state || null,
      preflightSource: item.accuracyPreflight?.source || null,
      qualityValid: quality?.valid ?? null,
      qualityScore: quality?.score ?? null,
      qualityReasons: Array.isArray(quality?.reasons) ? quality.reasons.slice(0, 6) : [],
      detectedLanguage: quality?.detectedLanguage || null,
      arabicRatio: quality?.arabicRatio ?? null,
      cueCount: quality?.cueCount ?? null,
      deliveryFailure: item.accuracyPreflight?.deliveryFailure === true,
      releaseName: String(item.releaseName || item.fileName || item.name || '').slice(0, 160),
    };
  });
  return {
    total: evaluated.length,
    counts,
    // Availability of Arabic and independently verified timing are disjoint metrics.
    coverageOK: counts.certified + counts.safe + counts.recovery > 0,
    releaseVerified: counts.certified + counts.safe > 0,
    topDecision: v5Top?.proof?.decision || null,
    topCandidateId: telemetryCandidateId(v5Top?.candidateId),
    topProofFloor: v5Top?.proof?.proofFloor ?? null,
    topConfidence: v5Top?.proof?.confidence || null,
    topHardFailures: v5Top?.proof?.hardFailures || [],
    topReasons: v5Top?.proof?.reasons || [],
    topTimingEvidence: timingTelemetry(v5Top?.evidence?.timing || {}),
    legacyTopCandidateId: telemetryCandidateId(legacyTop?.candidateId),
    legacyTopDecision,
    topDisagreesWithLegacy: Boolean(v5Top && legacyTop && v5Top.candidateId !== legacyTop.candidateId),
    legacyTopWouldBeWithheld: ['withhold', 'reject'].includes(legacyTopDecision),
    legacyTopNotCertified: Boolean(legacyTop && legacyTopDecision !== 'certified'),
    topCandidates,
  };
}

export function runV5Shadow(results = [], search = {}, options = {}) {
  const evaluated = evaluateV5Candidates(results, search, options);
  return { evaluated, summary: summarizeV5Evaluation(evaluated) };
}
