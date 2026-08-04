import { config as appConfig } from '../config.js';
import { isArabicLanguage } from './language.js';
import {
  normalizedStringSimilarity,
  parseRelease,
  stableFingerprint,
  tokenOverlapScore,
} from './releaseParser.js';

function sameNumber(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Number(a) === Number(b);
}

function exists(value) {
  return value !== null && value !== undefined && value !== '';
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function addReason(reasons, scoreRef, value, reason) {
  scoreRef.value += value;
  reasons.push({ value, reason });
}

function providerPriority(provider) {
  const name = lower(provider);
  if (name === 'vault') return 900;
  if (name === 'registry') return 1100;
  if (name === 'opensubtitles') return 140;
  if (name === 'subdl') return 120;
  if (name === 'subsource') return 85;
  if (name === 'yify') return 35;
  return 0;
}

const RELEASE_FIELDS = [
  { key: 'quality', weight: 7, critical: true },
  { key: 'source', weight: 8, critical: true },
  { key: 'releaseGroup', weight: 9, critical: true },
  { key: 'service', weight: 6, critical: true },
  { key: 'codecFamily', weight: 4, critical: false },
  { key: 'bitDepth', weight: 2, critical: false },
  { key: 'hdr', weight: 3, critical: false },
  { key: 'audioCodec', weight: 3, critical: false },
  { key: 'audioProfile', weight: 2, critical: false },
  { key: 'audioChannels', weight: 2, critical: false },
  { key: 'edition', weight: 11, critical: true },
  { key: 'year', weight: 3, critical: true },
  { key: 'season', weight: 10, critical: true },
  { key: 'episode', weight: 12, critical: true },
];

function releaseValueMatches(key, target, candidate) {
  if (key === 'fps') return Math.abs(Number(target) - Number(candidate)) <= 0.02;
  return lower(target) === lower(candidate);
}

export function buildReleaseMatch(target, release) {
  const matched = [];
  const mismatched = [];
  const missing = [];
  let matchedWeight = 0;
  let mismatchWeight = 0;
  let criticalMismatches = 0;
  let targetFields = 0;

  for (const field of RELEASE_FIELDS) {
    if (!exists(target[field.key])) continue;
    targetFields += 1;
    if (!exists(release[field.key])) {
      missing.push(field.key);
      continue;
    }
    if (releaseValueMatches(field.key, target[field.key], release[field.key])) {
      matched.push(field.key);
      matchedWeight += field.weight;
    } else {
      mismatched.push(field.key);
      mismatchWeight += field.weight;
      if (field.critical) criticalMismatches += 1;
    }
  }

  if (missing.includes('edition')) {
    mismatchWeight += 11;
    criticalMismatches += 1;
  } else if (!exists(target.edition) && exists(release.edition) && release.edition !== 'theatrical') {
    mismatched.push('edition');
    mismatchWeight += 8;
    criticalMismatches += 1;
  }

  if (exists(target.fps)) {
    targetFields += 1;
    if (!exists(release.fps)) {
      missing.push('fps');
    } else if (releaseValueMatches('fps', target.fps, release.fps)) {
      matched.push('fps');
      matchedWeight += 6;
    } else {
      mismatched.push('fps');
      mismatchWeight += 6;
      criticalMismatches += 1;
    }
  }

  const similarity = normalizedStringSimilarity(target.raw, release.raw);
  const exactFingerprint = Boolean(
    target.raw
    && release.raw
    && stableFingerprint(target.raw) === stableFingerprint(release.raw),
  );
  const has = key => matched.includes(key);
  let tier = 0;

  if (targetFields > 0) {
    if (exactFingerprint && criticalMismatches === 0) tier = 6;
    else if (
      has('releaseGroup')
      && has('source')
      && has('quality')
      && criticalMismatches === 0
    ) tier = 5;
    else if (
      criticalMismatches === 0
      && (
        (has('releaseGroup') && (has('source') || has('quality')))
        || (has('source') && has('quality') && matched.length >= 3)
      )
    ) tier = 4;
    else if (criticalMismatches === 0 && has('source') && has('quality')) tier = 3;
    else if (criticalMismatches === 0 && (matchedWeight >= 9 || (similarity >= 0.88 && matched.length))) tier = 2;
    else if (matched.length) tier = 1;
  }

  if (criticalMismatches > 0) tier = Math.min(tier, 1);
  return {
    tier,
    exactFingerprint,
    targetFields,
    matched,
    mismatched,
    missing,
    matchedWeight,
    mismatchWeight,
    criticalMismatches,
    similarity: Number(similarity.toFixed(4)),
    priority: (tier * 10_000) + (matchedWeight * 100) - (mismatchWeight * 120) + Math.round(similarity * 100),
  };
}

export function scoreSubtitle(candidate, search = {}) {
  const filename = search.extra?.filename || search.filename || search.extra?.videoId || search.extra?.videoID || '';
  const extraFps = search.extra?.fps ?? search.extra?.frameRate ?? search.extra?.frame_rate;
  const extraGroup = search.extra?.releaseGroup ?? search.extra?.release_group;
  const fpsHint = exists(extraFps)
    ? (/\bfps\b/i.test(String(extraFps)) ? extraFps : `${extraFps}fps`)
    : null;
  const groupHint = exists(extraGroup)
    ? (/^-|\[/.test(String(extraGroup)) ? extraGroup : `-${extraGroup}`)
    : null;
  const releaseHints = [
    search.extra?.quality ?? search.extra?.video_quality,
    search.extra?.resolution ?? search.extra?.video_resolution,
    search.extra?.videoQuality,
    search.extra?.source ?? search.extra?.videoSource,
    search.extra?.service ?? search.extra?.streamingService,
    search.extra?.codec ?? search.extra?.video_codec,
    search.extra?.videoCodec,
    search.extra?.audio ?? search.extra?.audioCodec,
    search.extra?.audioChannels ?? search.extra?.audio_channels,
    search.extra?.hdr,
    search.extra?.bitDepth ?? search.extra?.bit_depth,
    search.extra?.edition ?? search.extra?.cut ?? search.extra?.videoEdition,
    fpsHint,
    groupHint,
  ].filter(value => exists(value) && String(value).length <= 80);
  const target = parseRelease([filename || search.query || '', ...releaseHints].join(' '));
  const release = parseRelease(candidate.releaseName || candidate.fileName || candidate.name || candidate.title || '');
  const releaseMatch = buildReleaseMatch(target, release);

  const scoreRef = { value: 0 };
  const reasons = [];
  const add = (value, reason) => addReason(reasons, scoreRef, value, reason);

  add(providerPriority(candidate.provider), `provider-priority:${candidate.provider || 'unknown'}`);

  if (candidate.provider === 'vault') add(1200, 'personal-vault-first');
  if (candidate.sourceType === 'personal-vault-exact-hash') add(1200, 'vault-exact-hash');

  if (isArabicLanguage(candidate.lang || candidate.language)) add(220, 'arabic-language');
  if (candidate.isOriginalArabic || candidate.originalLanguage === 'ar') add(140, 'original-arabic');

  const hasExactHash = Boolean(search.videoHash && lower(candidate.movieHash || candidate.hash) === lower(search.videoHash));
  if (hasExactHash) add(1800, 'exact-video-hash-match');
  if (candidate.matchedByHash) add(700, 'provider-confirmed-hash-match');

  if (search.imdbId && lower(candidate.imdbId) === lower(search.imdbId)) add(420, 'imdb-match');
  if (search.tmdbId && lower(candidate.tmdbId) === lower(search.tmdbId)) add(260, 'tmdb-match');

  const season = search.season ?? search.extra?.season ?? target.season;
  const episode = search.episode ?? search.extra?.episode ?? target.episode;
  const candidateSeason = candidate.season ?? release.season;
  const candidateEpisode = candidate.episode ?? release.episode;

  if (sameNumber(candidateSeason, season)) add(360, 'season-match');
  else if (exists(season) && exists(candidateSeason)) add(-900, 'season-mismatch');

  if (sameNumber(candidateEpisode, episode)) add(420, 'episode-match');
  else if (exists(episode) && exists(candidateEpisode)) add(-1100, 'episode-mismatch');

  const overlap = tokenOverlapScore(target.tokens, release.tokens);
  if (overlap >= 0.75) add(100, 'release-token-exactish');
  else if (overlap >= 0.55) add(70, 'release-token-high');
  else if (overlap >= 0.35) add(35, 'release-token-medium');
  else if (overlap >= 0.18) add(10, 'release-token-low');

  if (target.quality && release.quality) {
    if (target.quality === release.quality) add(18, 'quality-match');
    else add(-2, 'quality-different');
  }

  if (target.source && release.source) {
    if (target.source === release.source) add(25, 'source-match');
    else add(-5, 'source-different');
  }

  if (target.codec && release.codec) {
    if (target.codecFamily === release.codecFamily) add(8, 'codec-match');
    else add(0, 'codec-different');
  }

  if (target.releaseGroup && release.releaseGroup) {
    if (target.releaseGroup === release.releaseGroup) add(30, 'release-group-match');
    else add(0, 'release-group-different');
  }

  if (target.hdr && release.hdr) {
    if (target.hdr === release.hdr) add(5, 'hdr-match');
    else add(0, 'hdr-different');
  }

  if (target.service && release.service) {
    if (target.service === release.service) add(15, 'streaming-service-match');
    else add(-3, 'streaming-service-different');
  }

  if (target.bitDepth && release.bitDepth) {
    if (target.bitDepth === release.bitDepth) add(4, 'bit-depth-match');
    else add(0, 'bit-depth-different');
  }

  if (target.audioCodec && release.audioCodec) {
    if (target.audioCodec === release.audioCodec) add(5, 'audio-codec-match');
    else add(0, 'audio-codec-different');
  }

  if (target.audioChannels && release.audioChannels) {
    if (target.audioChannels === release.audioChannels) add(4, 'audio-channels-match');
    else add(0, 'audio-channels-different');
  }

  if (target.audioProfile && release.audioProfile) {
    if (target.audioProfile === release.audioProfile) add(3, 'audio-profile-match');
    else add(0, 'audio-profile-different');
  }

  if (target.edition && release.edition) {
    if (target.edition === release.edition) add(90, 'edition-match');
    else add(-120, 'edition-mismatch');
  } else if (target.edition && !release.edition) {
    add(-60, 'edition-missing');
  } else if (!target.edition && release.edition && release.edition !== 'theatrical') {
    add(-80, 'unexpected-special-edition');
  }

  if (target.fps && release.fps) {
    if (Math.abs(target.fps - release.fps) <= 0.02) add(20, 'fps-match');
    else add(-30, 'fps-mismatch');
  }

  if (target.year && release.year) {
    if (target.year === release.year) add(40, 'year-match');
    else add(-100, 'year-mismatch');
  }

  if (releaseMatch.exactFingerprint) add(100, 'exact-release-name-fingerprint');
  else if (releaseMatch.similarity >= 0.9) add(35, 'deterministic-filename-similarity');
  else if (releaseMatch.similarity >= 0.78) add(15, 'deterministic-filename-similarity');

  const downloads = Number(candidate.downloads || candidate.downloadCount || 0);
  if (downloads > 0) add(Math.min(65, Math.log10(downloads + 1) * 22), 'download-popularity-capped');

  const rating = Number(candidate.rating || 0);
  if (rating > 0) add(Math.min(45, rating * 8), 'rating-capped');

  if (candidate.trusted || candidate.uploaderRank === 'trusted' || candidate.fromTrustedSource) add(90, 'trusted');
  const qualityScore = Number(candidate.quality?.score ?? candidate.qualityScore ?? 0);
  if (qualityScore > 0) add(Math.min(180, qualityScore * 1.8), 'verified-subtitle-quality');
  if (candidate.hearingImpaired || candidate.sdh || /\b(sdh|hi|hearing impaired)\b/i.test(candidate.name || '')) add(-260, 'hearing-impaired');
  if (candidate.machineTranslated || candidate.automatedTranslated || candidate.autoTranslated) add(-1200, 'machine-or-ai-translated');
  if (!candidate.download && !candidate.url) add(-2000, 'missing-download-url');

  return { score: Math.round(scoreRef.value), reasons, release, target, releaseMatch };
}

export function makeDedupeKey(item) {
  const name = lower(item.releaseName || item.fileName || item.name || item.title || '').replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
  const season = item.season ?? '';
  const episode = item.episode ?? '';
  const lang = lower(item.lang || item.language || 'ara');
  const provider = lower(item.provider || '');
  const hash = lower(item.movieHash || item.hash || '');
  if (hash) return `${lang}:${season}:${episode}:hash:${hash}`;
  return `${lang}:${season}:${episode}:${provider}:${name.slice(0, 96)}`;
}

function evidenceRank(item) {
  const reasons = item.scoreReasons || [];
  if (item.sourceType === 'personal-vault-exact-hash' || item.sourceType === 'version-registry-exact-hash') return 3;
  if (reasons.some(reason => reason.reason === 'exact-video-hash-match')) return 3;
  if (reasons.some(reason => reason.reason === 'provider-confirmed-hash-match')) return 2;
  return 0;
}

function releaseFamilyKey(item) {
  const release = item.parsedRelease || {};
  const fps = Number.isFinite(Number(release.fps)) ? Number(release.fps).toFixed(3) : '';
  const fields = [release.source, release.edition, release.releaseGroup, release.quality, fps]
    .map(value => lower(value))
    .filter(Boolean);
  return fields.length ? fields.join(':') : `provider:${lower(item.provider || 'unknown')}`;
}

function diversifyPlausibleAlternatives(items, scoreWindow = 240) {
  const output = [];
  let cursor = 0;
  while (cursor < items.length) {
    const anchor = items[cursor];
    const anchorEvidence = evidenceRank(anchor);
    const band = [];
    while (
      cursor < items.length
      && evidenceRank(items[cursor]) === anchorEvidence
      && items[cursor].score >= anchor.score - scoreWindow
    ) {
      band.push(items[cursor]);
      cursor += 1;
    }
    const seenFamilies = new Set();
    const selected = new Set();
    for (const item of band) {
      const family = releaseFamilyKey(item);
      if (seenFamilies.has(family)) continue;
      seenFamilies.add(family);
      selected.add(item);
      output.push(item);
    }
    for (const item of band) if (!selected.has(item)) output.push(item);
  }
  return output;
}

export function rankAndFilter(results, search = {}, config = {}) {
  const outputArabicOnly = config.outputArabicOnly ?? true;
  const excludeHI = config.excludeHearingImpaired ?? false;
  const excludeMachine = config.excludeMachineTranslated ?? true;
  const maxPerRelease = config.maxReturnedPerRelease ?? 1;
  const minRankScore = config.minRankScore ?? appConfig.ranking.minRankScore ?? -250;
  const seenCounts = new Map();

  const ranked = [];
  for (const item of results) {
    if (!item) continue;
    if (outputArabicOnly && !isArabicLanguage(item.lang || item.language || item.name || item.releaseName)) continue;
    if (excludeHI && (item.hearingImpaired || item.sdh)) continue;
    if (excludeMachine && (item.machineTranslated || item.automatedTranslated || item.autoTranslated)) continue;
    if (config.strictQualityFilters && item.quality && item.quality.valid === false) continue;
    const scoring = scoreSubtitle(item, search);
    if (scoring.score < minRankScore) continue;
    ranked.push({
      ...item,
      score: scoring.score,
      scoreReasons: scoring.reasons,
      parsedRelease: scoring.release,
      releaseMatch: scoring.releaseMatch,
      releaseMatchTier: scoring.releaseMatch.tier,
    });
  }

  ranked.sort((a, b) => {
    const evidenceDelta = evidenceRank(b) - evidenceRank(a);
    if (evidenceDelta) return evidenceDelta;
    if (b.score !== a.score) return b.score - a.score;
    if (Boolean(b.trusted) !== Boolean(a.trusted)) return b.trusted ? 1 : -1;
    if ((b.provider === 'vault') !== (a.provider === 'vault')) return b.provider === 'vault' ? 1 : -1;
    if (a.releaseMatch?.priority !== b.releaseMatch?.priority) {
      return (b.releaseMatch?.priority || 0) - (a.releaseMatch?.priority || 0);
    }
    const downloadDelta = Number(b.downloads || b.downloadCount || 0) - Number(a.downloads || a.downloadCount || 0);
    if (downloadDelta) return downloadDelta;
    return `${a.provider || ''}:${a.id || a.providerId || ''}`.localeCompare(`${b.provider || ''}:${b.id || b.providerId || ''}`);
  });

  const deduped = [];
  for (const item of ranked) {
    const key = makeDedupeKey(item);
    const count = seenCounts.get(key) || 0;
    if (count >= maxPerRelease) continue;
    seenCounts.set(key, count + 1);
    deduped.push(item);
  }

  return diversifyPlausibleAlternatives(deduped);
}
