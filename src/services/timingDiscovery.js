import { buildUniversalVideoProfile, compareUniversalVideoProfiles } from '../utils/universalVideoIdentity.js';
import { hasSubtitleIdentityConflict } from '../utils/scoring.js';

// Valid Arabic text proves availability, not suitability for the playback release.
export function needsTimingDiscovery(results = [], search = {}) {
  const target = search.videoProfile || buildUniversalVideoProfile(search);
  if (!target.sourceFamily && !target.videoHash) return false;
  return !results.some(item => {
    if (item.accuracyPreflight?.state !== 'valid' || hasSubtitleIdentityConflict(item, search)) return false;
    const comparison = compareUniversalVideoProfiles(target, item, { mediaType: search.type });
    if (comparison.hardConflict || item.actualTimingEvidence?.verdict === 'incompatible') return false;
    if (item.actualTimingEvidence?.measured && item.actualTimingEvidence?.verdict === 'aligned') return true;
    if (comparison.exactHash || (target.videoHash && item.matchedByHash)) return true;
    return comparison.sourceMatch === true;
  });
}
