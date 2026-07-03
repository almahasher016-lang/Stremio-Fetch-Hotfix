import { config as appConfig } from '../config.js';
import { isArabicLanguage } from './language.js';
import { parseRelease, tokenOverlapScore } from './releaseParser.js';

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
  if (name === 'opensubtitles') return 140;
  if (name === 'subdl') return 120;
  if (name === 'subsource') return 85;
  if (name === 'yify') return 35;
  return 0;
}

export function scoreSubtitle(candidate, search = {}) {
  const filename = search.extra?.filename || search.extra?.videoId || search.filename || '';
  const target = parseRelease(filename || search.query || '');
  const release = parseRelease(candidate.releaseName || candidate.fileName || candidate.name || candidate.title || '');

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
  if (search.videoHash && candidate.searchReason === 'hash-first') add(700, 'hash-first-provider-result');

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
  if (overlap >= 0.75) add(360, 'release-token-exactish');
  else if (overlap >= 0.55) add(250, 'release-token-high');
  else if (overlap >= 0.35) add(130, 'release-token-medium');
  else if (overlap >= 0.18) add(45, 'release-token-low');

  if (target.quality && release.quality) {
    if (target.quality === release.quality) add(220, 'quality-match');
    else add(-260, 'quality-mismatch');
  }

  if (target.source && release.source) {
    if (target.source === release.source) add(260, 'source-match');
    else add(-360, 'source-mismatch');
  }

  if (target.codec && release.codec) {
    if (target.codec === release.codec) add(90, 'codec-match');
    else add(-110, 'codec-mismatch');
  }

  if (target.releaseGroup && release.releaseGroup) {
    if (target.releaseGroup === release.releaseGroup) add(340, 'release-group-match');
    else add(-230, 'release-group-mismatch');
  }

  if (target.hdr && release.hdr) {
    if (target.hdr === release.hdr) add(55, 'hdr-match');
    else add(-70, 'hdr-mismatch');
  }

  const downloads = Number(candidate.downloads || candidate.downloadCount || 0);
  if (downloads > 0) add(Math.min(65, Math.log10(downloads + 1) * 22), 'download-popularity-capped');

  const rating = Number(candidate.rating || 0);
  if (rating > 0) add(Math.min(45, rating * 8), 'rating-capped');

  if (candidate.trusted || candidate.uploaderRank === 'trusted' || candidate.fromTrustedSource) add(90, 'trusted');
  if (candidate.hearingImpaired || candidate.sdh || /\b(sdh|hi|hearing impaired)\b/i.test(candidate.name || '')) add(-260, 'hearing-impaired');
  if (candidate.machineTranslated || candidate.automatedTranslated || candidate.autoTranslated) add(-1200, 'machine-or-ai-translated');
  if (!candidate.download && !candidate.url) add(-2000, 'missing-download-url');

  return { score: Math.round(scoreRef.value), reasons, release, target };
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
    const scoring = scoreSubtitle(item, search);
    if (scoring.score < minRankScore) continue;
    ranked.push({ ...item, score: scoring.score, scoreReasons: scoring.reasons, parsedRelease: scoring.release });
  }

  ranked.sort((a, b) => {
    if ((b.provider === 'vault') !== (a.provider === 'vault')) return b.provider === 'vault' ? 1 : -1;
    const aHash = a.scoreReasons?.some(r => r.reason.includes('hash')) ? 1 : 0;
    const bHash = b.scoreReasons?.some(r => r.reason.includes('hash')) ? 1 : 0;
    if (aHash !== bHash) return bHash - aHash;
    return b.score - a.score;
  });

  const deduped = [];
  for (const item of ranked) {
    const key = makeDedupeKey(item);
    const count = seenCounts.get(key) || 0;
    if (count >= maxPerRelease) continue;
    seenCounts.set(key, count + 1);
    deduped.push(item);
  }

  return deduped;
}
