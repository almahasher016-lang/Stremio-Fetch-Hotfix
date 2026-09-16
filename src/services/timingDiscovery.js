import { buildUniversalVideoProfile, compareUniversalVideoProfiles } from '../utils/universalVideoIdentity.js';
import { hasSubtitleIdentityConflict } from '../utils/scoring.js';

// A release-family match, filename, reported movie hash or valid Arabic file is NOT
// measured synchronization. Keep searching within the caller's bounded eight-second
// recovery window until an actual reference-aligned timeline is demonstrated.
export function needsTimingDiscovery(results = [], search = {}) {
  const target = search.videoProfile || buildUniversalVideoProfile(search);
  if (!target.sourceFamily && !target.videoHash) return false;
  return !results.some(item => {
    if (item.accuracyPreflight?.state !== 'valid' || hasSubtitleIdentityConflict(item, search)) return false;
    const comparison = compareUniversalVideoProfiles(target, item, { mediaType: search.type });
    if (comparison.hardConflict) return false;
    const measured = item.actualTimingEvidence;
    if (measured?.measured !== true || measured.exactVideoHash !== true || measured.verdict !== 'aligned') return false;
    const offset = Number(measured.offsetMs);
    const median = Number(measured.residualMedianMs);
    const p90 = Number(measured.residualP90Ms);
    const coverage = Number(measured.anchorCoverage);
    return [offset, median, p90, coverage].every(Number.isFinite)
      && Math.abs(offset) <= 300 && median >= 0 && median <= 200
      && p90 >= 0 && p90 <= 300 && coverage >= 0.58;
  });
}
