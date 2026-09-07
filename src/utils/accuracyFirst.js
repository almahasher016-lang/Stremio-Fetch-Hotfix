import { sourceFamily } from './timingCompatibility.js';

function lower(value) {
  return String(value || '').toLowerCase();
}

const HARD_RELEASE_CONFLICTS = new Set(['season', 'episode', 'edition', 'year', 'fps']);

function evidenceRank(item) {
  const reasons = item?.scoreReasons || [];
  if (item?.sourceType === 'personal-vault-exact-hash' || item?.sourceType === 'version-registry-exact-hash') return 3;
  if (reasons.some(reason => reason.reason === 'exact-video-hash-match')) return 3;
  if (reasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) return 2;
  return 0;
}

function meaningfulReleaseMatch(item) {
  const match = item?.releaseMatch;
  if (!match || Number(match.targetFields || 0) < 2) return null;
  return match;
}

function verifiedQualityRank(item) {
  const quality = item?.accuracyPreflight?.quality || item?.quality || null;
  const validBonus = quality?.valid === true ? 1000 : 0;
  const score = Number(quality?.score ?? item?.qualityScore ?? 0);
  return validBonus + Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
}

function releaseText(item) {
  return item?.releaseName || item?.fileName || item?.name || item?.title || '';
}

function hardConflictCount(item) {
  const mismatched = item?.releaseMatch?.mismatched;
  if (!Array.isArray(mismatched)) return 0;
  return mismatched.reduce((count, field) => count + (HARD_RELEASE_CONFLICTS.has(field) ? 1 : 0), 0);
}

function sourceFamilyRank(item, targetFamily) {
  if (!targetFamily) return 0;
  const candidateFamily = sourceFamily(releaseText(item));
  if (!candidateFamily) return 1;
  return candidateFamily === targetFamily ? 2 : 0;
}

function timingReferenceRank(item) {
  const evidence = item?.timingReferenceEvidence;
  if (!evidence?.exactVideoHash) return 0;
  const score = Number(evidence.matchScore || 0);
  return Math.max(0, Math.min(10_000, Number.isFinite(score) ? score : 0));
}

function actualTimingRank(item) {
  const evidence = item?.actualTimingEvidence;
  if (!evidence?.measured || !evidence?.exactVideoHash) return null;
  const score = Number(evidence.rankScore);
  return Number.isFinite(score) ? score : 0;
}

export function prioritizeAccurateSubtitles(results = [], search = {}) {
  const targetFamily = sourceFamily(search?.filename || search?.extra?.filename || search?.query || search?.title || '');

  return [...results].sort((a, b) => {
    const evidenceDelta = evidenceRank(b) - evidenceRank(a);
    if (evidenceDelta) return evidenceDelta;

    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

    // Actual cue-timeline evidence is stronger than release-name/source-family guesses.
    // Compare it only when both candidates were measured, so a transient reference/preflight
    // failure never blindly penalizes an unmeasured subtitle.
    const aActualTiming = actualTimingRank(a);
    const bActualTiming = actualTimingRank(b);
    if (aActualTiming !== null && bActualTiming !== null) {
      const actualTimingDelta = bActualTiming - aActualTiming;
      if (actualTimingDelta) return actualTimingDelta;
    }

    // An English subtitle returned for the exact video hash describes the actual playback
    // timeline more reliably than a filename-derived source-family guess.
    const referenceDelta = timingReferenceRank(b) - timingReferenceRank(a);
    if (referenceDelta) return referenceDelta;

    const familyDelta = sourceFamilyRank(b, targetFamily) - sourceFamilyRank(a, targetFamily);
    if (familyDelta) return familyDelta;

    const aMatch = meaningfulReleaseMatch(a);
    const bMatch = meaningfulReleaseMatch(b);
    if (aMatch || bMatch) {
      const aCritical = aMatch?.criticalMismatches ?? Number.MAX_SAFE_INTEGER;
      const bCritical = bMatch?.criticalMismatches ?? Number.MAX_SAFE_INTEGER;
      if (aCritical !== bCritical) return aCritical - bCritical;

      const tierDelta = (bMatch?.tier || 0) - (aMatch?.tier || 0);
      if (tierDelta) return tierDelta;

      const priorityDelta = (bMatch?.priority || 0) - (aMatch?.priority || 0);
      if (priorityDelta) return priorityDelta;
    }

    const qualityDelta = verifiedQualityRank(b) - verifiedQualityRank(a);
    if (qualityDelta) return qualityDelta;

    if (Boolean(b?.trusted) !== Boolean(a?.trusted)) return b?.trusted ? 1 : -1;

    const scoreDelta = Number(b?.score || 0) - Number(a?.score || 0);
    if (scoreDelta) return scoreDelta;

    if ((b?.provider === 'vault') !== (a?.provider === 'vault')) return b?.provider === 'vault' ? 1 : -1;

    const downloadDelta = Number(b?.downloads || b?.downloadCount || 0) - Number(a?.downloads || a?.downloadCount || 0);
    if (downloadDelta) return downloadDelta;

    return `${lower(a?.provider)}:${a?.id || a?.providerId || ''}`
      .localeCompare(`${lower(b?.provider)}:${b?.id || b?.providerId || ''}`);
  });
}

export function hasStrongTimingEvidence(item, search = {}) {
  if (evidenceRank(item) > 0 || actualTimingRank(item) !== null || timingReferenceRank(item) > 0) return true;
  if (hardConflictCount(item) > 0) return false;
  const targetFamily = sourceFamily(search?.filename || search?.extra?.filename || search?.query || search?.title || '');
  const candidateFamily = sourceFamily(releaseText(item));
  if (targetFamily && candidateFamily && targetFamily === candidateFamily) return true;
  const match = meaningfulReleaseMatch(item);
  return Boolean(match && Number(match.criticalMismatches || 0) === 0 && Number(match.tier || 0) >= 2);
}

export function applyPostAccuracyScoreFloor(results = [], search = {}, minScore = Number.NEGATIVE_INFINITY) {
  const ranked = prioritizeAccurateSubtitles(results, search);
  const floor = Number(minScore);
  if (!Number.isFinite(floor)) return ranked;
  return ranked.filter(item => Number(item?.score ?? Number.NEGATIVE_INFINITY) >= floor || hasStrongTimingEvidence(item, search));
}

export function prioritizeAndLimitAccurateSubtitles(results = [], search = {}, limit = Infinity) {
  const ranked = prioritizeAccurateSubtitles(results, search);
  const safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit)) return ranked;
  return ranked.slice(0, Math.max(0, Math.floor(safeLimit)));
}
