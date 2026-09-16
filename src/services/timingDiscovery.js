import { buildUniversalVideoProfile, compareUniversalVideoProfiles } from '../utils/universalVideoIdentity.js';
import { hasSubtitleIdentityConflict } from '../utils/scoring.js';

// Valid Arabic, filename/source-family agreement and movie hashes establish discovery
// hints, not actual cue-to-playback synchronization. The caller bounds recovery to 8s.
export function needsTimingDiscovery(results = [], search = {}) {
  const target = search.videoProfile || buildUniversalVideoProfile(search);
  if (!target.sourceFamily && !target.videoHash) return false;
  return !results.some(item => {
    if (item.accuracyPreflight?.state !== 'valid' || hasSubtitleIdentityConflict(item, search)) return false;
    const comparison = compareUniversalVideoProfiles(target, item, { mediaType: search.type });
    if (comparison.hardConflict) return false;
    const measured = item.actualTimingEvidence;
    if (measured?.measured !== true || measured.exactVideoHash !== true || measured.verdict !== 'aligned') return false;
    const values = [measured.offsetMs, measured.residualMedianMs, measured.residualP90Ms, measured.anchorCoverage];
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return false;
    return Math.abs(measured.offsetMs) <= 300
      && measured.residualMedianMs >= 0 && measured.residualMedianMs <= 200
      && measured.residualP90Ms >= 0 && measured.residualP90Ms <= 300
      && measured.anchorCoverage >= 0.58;
  });
}
