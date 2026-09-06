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

function sourceFamily(value) {
  const text = lower(value).replace(/[._-]+/g, ' ');
  if (/\b(?:blu ray|brrip|bdrip|remux)\b/u.test(text)) return 'bluray';
  if (/\b(?:web dl|web rip|web)\b/u.test(text)) return 'web';
  if (/\bhdtv\b/u.test(text)) return 'hdtv';
  if (/\b(?:dvd rip|dvdrip|dvd)\b/u.test(text)) return 'dvd';
  if (/\b(?:hdcam|cam|telesync|telecine)\b/u.test(text)) return 'cam';
  return '';
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

export function prioritizeAccurateSubtitles(results = [], search = {}) {
  const targetFamily = sourceFamily(search?.filename || search?.extra?.filename || search?.query || search?.title || '');

  return [...results].sort((a, b) => {
    const evidenceDelta = evidenceRank(b) - evidenceRank(a);
    if (evidenceDelta) return evidenceDelta;

    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

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
