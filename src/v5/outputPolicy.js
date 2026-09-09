import { PROOF_DECISION } from './proofEngine.js';

const MODE = Object.freeze({
  STRICT: 'strict',
  BALANCED: 'balanced',
  RECOVERY: 'recovery',
});

function allowedDecisions(mode) {
  if (mode === MODE.RECOVERY) {
    return new Set([PROOF_DECISION.CERTIFIED, PROOF_DECISION.SAFE, PROOF_DECISION.RECOVERY]);
  }
  if (mode === MODE.BALANCED) {
    return new Set([PROOF_DECISION.CERTIFIED, PROOF_DECISION.SAFE]);
  }
  return new Set([PROOF_DECISION.CERTIFIED]);
}

export function selectV5Output(evaluated = [], { mode = MODE.STRICT, maxResults = 10 } = {}) {
  const allowed = allowedDecisions(mode);
  const limit = Math.max(0, Math.min(50, Number(maxResults) || 0));
  const selected = evaluated.filter(entry => allowed.has(entry?.proof?.decision)).slice(0, limit);
  return selected.map(entry => ({
    ...entry.item,
    v5Proof: entry.proof,
    v5Evidence: entry.evidence,
  }));
}

export function selectV5FailureFallback(results = []) {
  if (!Array.isArray(results)) return [];
  return results.filter(item => (
    item?.accuracyPreflight?.state !== 'rejected'
    && item?.accuracyPreflight?.deliveryFailure !== true
  ));
}

export function v5ModeFromEnvironment(env = process.env) {
  const raw = String(env.RESOLVER_V5_MODE || '').trim().toLowerCase();
  if (raw === MODE.STRICT || raw === MODE.BALANCED || raw === MODE.RECOVERY) return raw;
  return null;
}

export { MODE as V5_OUTPUT_MODE };
