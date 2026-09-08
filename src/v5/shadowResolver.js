import { buildCandidateEvidence } from './candidateEvidence.js';
import { buildTimelineConsensus } from './consensusEngine.js';
import { evaluateSubtitleProof, rankByProof } from './proofEngine.js';

function stableCandidateId(item = {}, index = 0) {
  return String(item.providerId || item.fileId || item.id || `${item.provider || 'candidate'}:${index}`);
}

export function evaluateV5Candidates(results = [], search = {}, { now = Date.now() } = {}) {
  const consensus = buildTimelineConsensus(results);
  const evaluated = results.map((item, index) => {
    const evidence = buildCandidateEvidence(item, search, consensus.get(item) || {}, now);
    const proof = evaluateSubtitleProof(evidence);
    return {
      item,
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

export function summarizeV5Evaluation(evaluated = []) {
  const counts = { certified: 0, safe: 0, recovery: 0, withhold: 0, reject: 0 };
  for (const entry of evaluated) {
    const decision = entry?.proof?.decision;
    if (decision in counts) counts[decision] += 1;
  }
  return {
    total: evaluated.length,
    counts,
    topDecision: evaluated[0]?.proof?.decision || null,
    topCandidateId: evaluated[0]?.candidateId || null,
    topProofFloor: evaluated[0]?.proof?.proofFloor ?? null,
  };
}

export function runV5Shadow(results = [], search = {}, options = {}) {
  const evaluated = evaluateV5Candidates(results, search, options);
  return {
    evaluated,
    summary: summarizeV5Evaluation(evaluated),
  };
}
