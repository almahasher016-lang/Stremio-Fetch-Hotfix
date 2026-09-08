import { parseRelease } from './releaseParser.js';
import { sourceFamily } from './timingCompatibility.js';

function lower(value) {
  return String(value || '').toLowerCase();
}

function exists(value) {
  return value !== null && value !== undefined && value !== '';
}

function sameNumber(a, b) {
  if (!exists(a) || !exists(b)) return false;
  return Number(a) === Number(b);
}

function catalogNumber(value) {
  return String(value || '').toLowerCase().replace(/^tt/, '').replace(/^0+/, '');
}

function normalizedMediaType(value) {
  const type = lower(value);
  if (['series', 'episode', 'tv', 'tvshow'].includes(type)) return 'series';
  if (type === 'movie') return 'movie';
  return '';
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

function itemRelease(item) {
  return item?.parsedRelease || parseRelease(releaseText(item));
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
  if (!evidence?.measured || !evidence?.exactVideoHash) return { classRank: 1, score: 0 };
  const classRank = evidence.verdict === 'aligned' ? 4 : evidence.verdict === 'repairable' ? 3 : 0;
  const score = Number(evidence.rankScore || 0);
  return { classRank, score: Number.isFinite(score) ? score : 0 };
}

function catalogIdentityMatch(item, search = {}) {
  if (exists(search.imdbId) && exists(item?.imdbId)
    && catalogNumber(search.imdbId) === catalogNumber(item.imdbId)) return true;
  if (exists(search.tmdbId) && exists(item?.tmdbId)
    && String(search.tmdbId) === String(item.tmdbId)) return true;
  return false;
}

function explicitEpisodeIdentityMatch(item, search = {}, target = {}) {
  const expectedSeason = search.season ?? search.extra?.season ?? target.season;
  const expectedEpisode = search.episode ?? search.extra?.episode ?? target.episode;
  if (!exists(expectedSeason) || !exists(expectedEpisode)) return false;
  const release = itemRelease(item);
  const seasons = [item?.season, release?.season].filter(exists);
  const episodes = [item?.episode, release?.episode].filter(exists);
  return seasons.some(value => sameNumber(value, expectedSeason))
    && episodes.some(value => sameNumber(value, expectedEpisode));
}

export function identityAuthorityRank(item, search = {}) {
  if (evidenceRank(item) > 0) return 6;
  const type = normalizedMediaType(search.type);
  if (!type) return 0;

  const target = parseRelease(search?.filename || search?.extra?.filename || search?.query || search?.title || '');
  const match = meaningfulReleaseMatch(item);
  const catalogMatch = catalogIdentityMatch(item, search);

  if (type === 'series') {
    const episodeMatch = explicitEpisodeIdentityMatch(item, search, target);
    if (catalogMatch && episodeMatch) return 5;
    if (episodeMatch) return 4;
    if (item?.searchReason === 'exact-metadata' && (exists(search.imdbId) || exists(search.tmdbId))) return 3;
    if (
      match
      && Number(match.criticalMismatches || 0) === 0
      && match.matched?.includes('season')
      && match.matched?.includes('episode')
    ) return 3;
    return 0;
  }

  if (catalogMatch) return 5;
  if (item?.searchReason === 'exact-metadata' && (exists(search.imdbId) || exists(search.tmdbId))) return 4;

  const release = itemRelease(item);
  const expectedYear = search.year ?? target.year;
  const yearMatch = exists(expectedYear) && sameNumber(release?.year, expectedYear);
  if (match && Number(match.criticalMismatches || 0) === 0) {
    if (match.exactFingerprint) return 3;
    if (yearMatch && Number(match.tier || 0) >= 2) return 3;
    if (item?.searchReason === 'release-fallback' && Number(match.tier || 0) >= 2) return 2;
  }
  return 0;
}

export function preferIdentityAuthority(results = [], search = {}) {
  if (results.length < 2 || !normalizedMediaType(search.type)) return results;
  const ranked = results.map(item => ({ item, authority: identityAuthorityRank(item, search) }));
  const best = ranked.reduce((value, entry) => Math.max(value, entry.authority), 0);
  const floor = best >= 4 ? 4 : best >= 3 ? 3 : best >= 2 ? 2 : 0;
  if (!floor) return results;
  const filtered = ranked.filter(entry => entry.authority >= floor).map(entry => entry.item);
  return filtered.length ? filtered : results;
}

export function prioritizeAccurateSubtitles(results = [], search = {}) {
  const targetFamily = sourceFamily(search?.filename || search?.extra?.filename || search?.query || search?.title || '');

  return [...results].sort((a, b) => {
    const authorityDelta = identityAuthorityRank(b, search) - identityAuthorityRank(a, search);
    if (authorityDelta) return authorityDelta;

    const evidenceDelta = evidenceRank(b) - evidenceRank(a);
    if (evidenceDelta) return evidenceDelta;

    const hardConflictDelta = hardConflictCount(a) - hardConflictCount(b);
    if (hardConflictDelta) return hardConflictDelta;

    // Positive cue-timeline proof beats unknown metadata; an unknown candidate still beats a
    // candidate proven structurally incompatible. This keeps failures fail-open without ignoring proof.
    const aActualTiming = actualTimingRank(a);
    const bActualTiming = actualTimingRank(b);
    const actualClassDelta = bActualTiming.classRank - aActualTiming.classRank;
    if (actualClassDelta) return actualClassDelta;
    if (aActualTiming.classRank !== 1) {
      const actualScoreDelta = bActualTiming.score - aActualTiming.score;
      if (actualScoreDelta) return actualScoreDelta;
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
  const actual = item?.actualTimingEvidence;
  if (evidenceRank(item) > 0 || actual?.verdict === 'aligned' || actual?.verdict === 'repairable' || timingReferenceRank(item) > 0) return true;
  if (hardConflictCount(item) > 0) return false;
  const targetFamily = sourceFamily(search?.filename || search?.extra?.filename || search?.query || search?.title || '');
  const candidateFamily = sourceFamily(releaseText(item));
  if (targetFamily && candidateFamily && targetFamily === candidateFamily) return true;
  const match = meaningfulReleaseMatch(item);
  return Boolean(match && Number(match.criticalMismatches || 0) === 0 && Number(match.tier || 0) >= 2);
}

export function applyPostAccuracyScoreFloor(results = [], search = {}, minScore = Number.NEGATIVE_INFINITY) {
  const ranked = preferIdentityAuthority(prioritizeAccurateSubtitles(results, search), search);
  const floor = Number(minScore);
  if (!Number.isFinite(floor)) return ranked;
  return ranked.filter(item => Number(item?.score ?? Number.NEGATIVE_INFINITY) >= floor || hasStrongTimingEvidence(item, search));
}

export function prioritizeAndLimitAccurateSubtitles(results = [], search = {}, limit = Infinity) {
  const ranked = preferIdentityAuthority(prioritizeAccurateSubtitles(results, search), search);
  const safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit)) return ranked;
  return ranked.slice(0, Math.max(0, Math.floor(safeLimit)));
}
