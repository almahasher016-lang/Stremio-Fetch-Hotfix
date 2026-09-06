function reasonLabels(item = {}) {
  const labels = [];
  const scoreReasons = Array.isArray(item.scoreReasons) ? item.scoreReasons : [];
  if (item.sourceType === 'version-registry-exact-hash') labels.push('verified-version-exact-hash');
  if (item.sourceType === 'personal-vault-exact-hash') labels.push('personal-vault-exact-hash');
  if (scoreReasons.some(reason => reason.reason === 'exact-video-hash-match')) labels.push('exact-video-hash');
  if (scoreReasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) labels.push('provider-confirmed-hash');
  if (item.releaseMatch?.tier) labels.push(`release-tier-${item.releaseMatch.tier}`);
  if (item.releaseMatch?.criticalMismatches === 0) labels.push('no-critical-release-conflicts');
  if (item.accuracyPreflight?.state === 'valid') labels.push('content-preflight-valid');
  if (item.accuracyPreflight?.state === 'degraded') labels.push('content-preflight-degraded');
  if (item.trusted) labels.push('trusted-provider-result');
  return labels;
}

function compactScoreReasons(item = {}) {
  const reasons = Array.isArray(item.scoreReasons) ? item.scoreReasons : [];
  return reasons
    .map(reason => ({ reason: reason.reason, points: Number(reason.points || 0) }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 12);
}

export function explainSubtitleRanking(results = [], search = {}) {
  return results.map((item, index) => {
    const next = results[index + 1] || null;
    const labels = reasonLabels(item);
    const quality = item.accuracyPreflight?.quality || item.quality || null;
    const releaseMatch = item.releaseMatch || null;
    const hardConflicts = Array.isArray(releaseMatch?.mismatched)
      ? releaseMatch.mismatched.filter(field => ['season', 'episode', 'edition', 'year', 'fps'].includes(field))
      : [];
    return {
      rank: index + 1,
      id: item.id || item.providerId || null,
      provider: item.provider || null,
      release: item.releaseName || item.fileName || item.name || null,
      summary: labels.slice(0, 5).join(' · ') || 'deterministic-score-order',
      evidence: {
        labels,
        score: Number(item.score || 0),
        releaseTier: Number(releaseMatch?.tier || item.releaseMatchTier || 0),
        releasePriority: Number(releaseMatch?.priority || 0),
        criticalMismatches: Number(releaseMatch?.criticalMismatches || 0),
        hardConflicts,
        trusted: Boolean(item.trusted),
        contentPreflight: item.accuracyPreflight || null,
        quality,
      },
      scoreReasons: compactScoreReasons(item),
      aheadOf: next ? {
        id: next.id || next.providerId || null,
        provider: next.provider || null,
        scoreDelta: Number(item.score || 0) - Number(next.score || 0),
        releaseTierDelta: Number(releaseMatch?.tier || 0) - Number(next.releaseMatch?.tier || 0),
      } : null,
      search: index === 0 ? {
        filename: search.filename || null,
        videoHashPresent: Boolean(search.videoHash || search.hash),
        season: search.season || null,
        episode: search.episode || null,
      } : undefined,
    };
  });
}
