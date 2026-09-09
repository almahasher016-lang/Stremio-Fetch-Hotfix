import { availabilityTier } from '../services/coverageEngine.js';
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

function cueCountOf(entry = {}) {
  const quality = entry?.item?.accuracyPreflight?.quality || entry?.item?.quality || {};
  return Math.max(0, Number(quality.cueCount) || 0);
}

function completeCandidates(entries = []) {
  const usable = entries.filter(entry => [
    PROOF_DECISION.CERTIFIED,
    PROOF_DECISION.SAFE,
    PROOF_DECISION.RECOVERY,
  ].includes(entry?.proof?.decision));
  const largestCueCount = usable.reduce((max, entry) => Math.max(max, cueCountOf(entry)), 0);
  if (largestCueCount < 300) return usable;

  // A trailer, teaser or "special look" can pass the per-file validity checks while containing
  // only a few dozen cues. When full-length alternatives exist for the same work, do not let
  // such a partial subtitle become the sole availability rescue.
  const completenessFloor = Math.max(80, Math.floor(largestCueCount * 0.35));
  const complete = usable.filter(entry => cueCountOf(entry) >= completenessFloor);
  return complete.length > 0 ? complete : usable;
}

export function selectV5Output(evaluated = [], { mode = MODE.STRICT, maxResults = 10 } = {}) {
  const allowed = allowedDecisions(mode);
  const limit = Math.max(0, Math.min(50, Number(maxResults) || 0));
  const complete = completeCandidates(evaluated);
  let selected = complete.filter(entry => allowed.has(entry?.proof?.decision)).slice(0, limit);
  let availabilityRescue = false;
  if (mode === MODE.BALANCED && limit > 0 && selected.length === 0) {
    // Preserve availability without letting one valid-but-partial subtitle hide full-length
    // alternatives. RECOVERY already requires strong identity, proven Arabic, fresh delivery
    // and valid subtitle integrity; keep up to three complete candidates for user choice.
    selected = complete.filter(entry => entry?.proof?.decision === PROOF_DECISION.RECOVERY)
      .slice(0, Math.min(3, limit));
    availabilityRescue = selected.length > 0;
  }
  return selected.map(entry => ({
    ...entry.item,
    availabilityTier: availabilityTier(entry.item, entry.proof?.decision),
    v5Proof: entry.proof,
    v5Evidence: entry.evidence,
    ...(availabilityRescue ? { v5AvailabilityRescue: true } : {}),
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
