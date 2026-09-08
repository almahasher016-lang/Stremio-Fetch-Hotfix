import { parseRelease } from '../utils/releaseParser.js';

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function numberEquals(left, right) {
  if (left == null || right == null || left === '' || right === '') return null;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(left) === String(right);
}

function optionalEquals(left, right) {
  if (left == null || right == null || left === '' || right === '') return null;
  return lower(left) === lower(right);
}

function fpsEquals(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!(a > 0) || !(b > 0)) return null;
  return Math.abs(a - b) <= 0.02;
}

function exactHashMatch(item = {}, search = {}) {
  const target = lower(search.videoHash || search.hash);
  if (!target) return false;
  return Boolean(item.matchedByHash || lower(item.movieHash || item.hash) === target);
}

function catalogIdMatch(item = {}, search = {}) {
  const targetImdb = lower(search.imdbId || (String(search.id || '').startsWith('tt') ? search.id : ''));
  const itemImdb = lower(item.imdbId || item.imdb_id);
  if (targetImdb && itemImdb) return targetImdb === itemImdb;

  const targetTmdb = String(search.tmdbId || '').trim();
  const itemTmdb = String(item.tmdbId || item.tmdb_id || '').trim();
  if (targetTmdb && itemTmdb) return targetTmdb === itemTmdb;
  return false;
}

function catalogSearchAnchored(item = {}, search = {}) {
  if (lower(item.searchReason) !== 'exact-metadata') return false;
  const hasImdb = Boolean(search.imdbId || /^tt\d{5,12}$/i.test(String(search.id || '')));
  const hasTmdb = Boolean(search.tmdbId);
  return hasImdb || hasTmdb;
}

function identityConflicts(item = {}, search = {}) {
  const conflicts = new Set();
  const releaseMismatches = Array.isArray(item.releaseMatch?.mismatched) ? item.releaseMatch.mismatched : [];
  for (const field of releaseMismatches) {
    if (['season', 'episode', 'year', 'edition'].includes(field)) conflicts.add(field);
  }

  const season = numberEquals(item.season, search.season);
  const episode = numberEquals(item.episode, search.episode);
  if (season === false) conflicts.add('season');
  if (episode === false) conflicts.add('episode');

  const targetImdb = lower(search.imdbId || (String(search.id || '').startsWith('tt') ? search.id : ''));
  const itemImdb = lower(item.imdbId || item.imdb_id);
  if (targetImdb && itemImdb && targetImdb !== itemImdb) conflicts.add('imdb');

  const targetTmdb = String(search.tmdbId || '').trim();
  const itemTmdb = String(item.tmdbId || item.tmdb_id || '').trim();
  if (targetTmdb && itemTmdb && targetTmdb !== itemTmdb) conflicts.add('tmdb');
  return [...conflicts];
}

function arabicProbability(quality = {}) {
  if (lower(quality.detectedLanguage) !== 'arabic') return 0;
  const arabicRatio = Math.max(0, Math.min(1, Number(quality.arabicRatio) || 0));
  const arabicWords = Math.max(0, Number(quality.arabicWordHits) || 0);
  const persianWords = Math.max(0, Number(quality.persianWordHits) || 0);
  const persianRatio = Math.max(0, Number(quality.persianDistinctiveRatio) || 0);
  if (persianWords > Math.max(4, arabicWords * 0.35) || persianRatio >= 0.012) return 0.2;
  if (arabicWords >= 50 && arabicRatio >= 0.75) return 0.9995;
  if (arabicWords >= 20 && arabicRatio >= 0.55) return 0.997;
  if (arabicWords >= 8 && arabicRatio >= 0.35) return 0.985;
  return Math.min(0.97, Math.max(0.7, arabicRatio));
}

function timingFamilyEvidence(item = {}, search = {}) {
  const mediaType = lower(search.type) === 'series' ? 'series' : 'movie';
  const target = parseRelease(search.filename || search.extra?.filename || search.query || '');
  const release = item.parsedRelease
    || parseRelease(item.releaseName || item.fileName || item.name || item.title || '');

  target.source ??= search.extra?.source || search.extra?.videoSource;
  target.service ??= search.extra?.service || search.extra?.streamingService;
  target.releaseGroup ??= search.extra?.releaseGroup || search.extra?.release_group;
  target.edition ??= search.extra?.edition || search.extra?.cut || search.extra?.videoEdition;
  target.fps = Number(search.fps || search.extra?.fps || search.extra?.frameRate || target.fps) || target.fps;
  target.season = search.season ?? search.extra?.season ?? target.season;
  target.episode = search.episode ?? search.extra?.episode ?? target.episode;

  release.source ??= item.source;
  release.service ??= item.service;
  release.releaseGroup ??= item.releaseGroup || item.release_group;
  release.edition ??= item.edition;
  release.fps = Number(item.fps || release.fps) || release.fps;
  release.season = item.season ?? release.season;
  release.episode = item.episode ?? release.episode;

  const sourceMatch = optionalEquals(target.source, release.source);
  const serviceMatch = optionalEquals(target.service, release.service);
  const groupMatch = optionalEquals(target.releaseGroup, release.releaseGroup);
  const editionMatch = optionalEquals(target.edition, release.edition);
  const fpsMatch = fpsEquals(target.fps, release.fps);
  const seasonMatch = numberEquals(target.season, release.season);
  const episodeMatch = numberEquals(target.episode, release.episode);

  // Resolution, codec, HDR and audio are intentionally absent here: those are useful ranking
  // signals, but a 1080p and 2160p encode from the same distribution timeline can share timing.
  const editionConflict = editionMatch === false;
  const fpsConflict = fpsMatch === false;
  const hardConflict = editionConflict || fpsConflict;
  const exactEpisode = mediaType !== 'series' || (seasonMatch === true && episodeMatch === true);

  const auxiliaryMatches = [serviceMatch, groupMatch, fpsMatch].filter(value => value === true).length;
  let tier = 0;
  let stableReleaseFamily = false;

  if (!hardConflict && sourceMatch === true && exactEpisode) {
    if (mediaType === 'series') {
      // Episode identity + distribution source is strong timing-family evidence. Different visual
      // resolutions are allowed because they commonly share the exact episode timeline.
      stableReleaseFamily = true;
      tier = auxiliaryMatches > 0 ? 6 : 5;
    } else if (auxiliaryMatches > 0) {
      // Movies need one more independent family signal because alternate cuts can share a source.
      stableReleaseFamily = true;
      tier = auxiliaryMatches >= 2 ? 6 : 5;
    } else {
      tier = 3;
    }
  } else if (!hardConflict && sourceMatch === true) {
    tier = 2;
  }

  return {
    stableReleaseFamily,
    timingFamilyTier: tier,
    sourceMatch,
    serviceMatch,
    releaseGroupMatch: groupMatch,
    editionMatch,
    fpsMatch,
    seasonMatch,
    episodeMatch,
    hardConflict,
  };
}

function timingEvidence(item = {}, search = {}, consensus = {}) {
  const measured = item.actualTimingEvidence || {};
  const exactHashReference = item.timingReferenceEvidence?.exactVideoHash === true;
  const exactTimeline = measured.measured === true
    && measured.exactVideoHash === true
    && measured.verdict === 'aligned';
  const legacyReleaseTier = Number(item.releaseMatchTier ?? item.releaseMatch?.tier ?? 0) || 0;
  const matched = Array.isArray(item.releaseMatch?.matched) ? item.releaseMatch.matched : [];
  const family = timingFamilyEvidence(item, search);
  const hardTimingConflict = measured.verdict === 'incompatible'
    || (Array.isArray(item.releaseMatch?.mismatched) && item.releaseMatch.mismatched.includes('fps'))
    || family.hardConflict;

  return {
    conflict: hardTimingConflict,
    exactTimeline,
    exactVideoHashReference: exactHashReference && measured.verdict !== 'incompatible',
    timelineSimilarity: Number(consensus.timelineSimilarity || 0),
    independentConsensusCount: Number(consensus.independentConsensusCount || 0),
    absoluteBoundsMatched: consensus.absoluteBoundsMatched === true,
    releaseTier: Math.max(legacyReleaseTier, family.timingFamilyTier),
    legacyReleaseTier,
    timingFamilyTier: family.timingFamilyTier,
    stableReleaseFamily: family.stableReleaseFamily,
    sourceMatch: family.sourceMatch,
    serviceMatch: family.serviceMatch,
    releaseGroupMatch: family.releaseGroupMatch,
    editionMatch: family.editionMatch,
    fpsMatch: family.fpsMatch === true || matched.includes('fps') || measured.exactVideoHash === true,
  };
}

function deliveryEvidence(item = {}, now = Date.now()) {
  const preflight = item.accuracyPreflight || {};
  const terminalFailure = preflight.deliveryFailure === true;
  const checkedAt = Number(preflight.checkedAt || 0);
  const local = ['vault', 'registry'].includes(lower(item.originalProvider || item.provider));
  const reachable = !terminalFailure && (preflight.state === 'valid' || local);
  const fresh = local || (checkedAt > 0 && now - checkedAt >= 0 && now - checkedAt <= 180_000);
  return { terminalFailure, reachable, fresh };
}

export function buildCandidateEvidence(item = {}, search = {}, consensus = {}, now = Date.now()) {
  const quality = item.quality || item.accuracyPreflight?.quality || {};
  const mediaType = lower(search.type) === 'series' ? 'series' : 'movie';
  const seasonMatch = numberEquals(item.season, search.season);
  const episodeMatch = numberEquals(item.episode, search.episode);
  const releaseMatched = Array.isArray(item.releaseMatch?.matched) ? item.releaseMatch.matched : [];
  const releaseMissing = Array.isArray(item.releaseMatch?.missing) ? item.releaseMatch.missing : [];
  const yearMatch = releaseMatched.includes('year') ? true : (releaseMissing.includes('year') ? null : undefined);

  return {
    identity: {
      mediaType,
      conflicts: identityConflicts(item, search),
      exactVideoHash: exactHashMatch(item, search),
      catalogIdMatch: catalogIdMatch(item, search),
      catalogSearchAnchored: catalogSearchAnchored(item, search),
      seasonMatch: seasonMatch ?? (mediaType === 'series' ? undefined : true),
      episodeMatch: episodeMatch ?? (mediaType === 'series' ? undefined : true),
      explicitEpisodeMatch: mediaType === 'series' && seasonMatch === true && episodeMatch === true,
      yearMatch,
      titleMatch: Number(item.releaseMatchTier ?? item.releaseMatch?.tier ?? 0) >= 2,
    },
    language: {
      detectedLanguage: quality.detectedLanguage || '',
      arabicProbability: arabicProbability(quality),
      providerArabicCode: ['ar', 'ara', 'arabic'].includes(lower(item.lang || item.language)),
      wrongLanguage: Array.isArray(quality.reasons) && quality.reasons.includes('wrong-language-persian'),
    },
    timing: timingEvidence(item, search, consensus),
    delivery: deliveryEvidence(item, now),
    integrity: {
      valid: quality.valid,
      parseFailure: Array.isArray(quality.reasons) && quality.reasons.includes('invalid-timed-cues'),
      cueCount: Number(quality.cueCount || 0),
      coverageRatio: quality.coverageRatio,
    },
  };
}
