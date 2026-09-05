function lower(value) {
  return String(value || '').toLowerCase();
}

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
  const validBonus = item?.quality?.valid === true ? 1000 : 0;
  const score = Number(item?.quality?.score ?? item?.qualityScore ?? 0);
  return validBonus + Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
}

export function prioritizeAccurateSubtitles(results = []) {
  return [...results].sort((a, b) => {
    const evidenceDelta = evidenceRank(b) - evidenceRank(a);
    if (evidenceDelta) return evidenceDelta;

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
