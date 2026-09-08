import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { rankAndFilter, scoreSubtitle } from '../utils/scoring.js';
import { applyPostAccuracyScoreFloor } from '../utils/accuracyFirst.js';
import { hasHardIdentityConflict, preserveAccurateCandidates } from '../services/subtitleServiceCore.js';
import { buildVideoIdentity, versionKeys } from '../utils/videoIdentity.js';
import { extractSubtitlePayload } from '../utils/subtitleArchive.js';
import { preflightSubtitleCandidate, createEncodingToken, verifyEncodingToken } from '../utils/encodingProxy.js';
import { buildOpenSubtitlesRequest, normalizeOpenSubtitlesItem } from '../providers/openSubtitles.js';
import { buildSubdlParams, expandSubdlSubtitles } from '../providers/subdl.js';

const base = { provider: 'subdl', lang: 'ara', download: 'https://example.com/a.srt' };
const movie = { type: 'movie', imdbId: 'tt1234567', year: 2026, filename: 'The.Mummy.2026.1080p.WEB-DL-GROUP.mkv' };
const show = { type: 'series', imdbId: 'tt1234567', season: 1, episode: 2, filename: 'Example.S01E02.1080p.WEB-DL-GROUP.mkv' };
function finalRank(items, search) {
  return applyPostAccuracyScoreFloor(
    rankAndFilter(items, search, { applyMinRankScore: false }).filter(item => !hasHardIdentityConflict(item, search)),
    search, 180,
  );
}
function srt(count = 5) {
  return Array.from({ length: count }, (_, i) => `${i + 1}\n00:00:${String(i + 1).padStart(2, '0')},000 --> 00:00:${String(i + 2).padStart(2, '0')},000\nهذه ترجمة عربية للاختبار\n`).join('\n');
}

test('structured wrong episode cannot re-enter through same-source score-floor bypass', () => {
  const wrong = { ...base, releaseName: 'Example.1080p.WEB-DL-GROUP', season: 1, episode: 3 };
  assert.deepEqual(finalRank([wrong], show), []);
  assert.deepEqual(finalRank([{ ...wrong, episode: 2, fileName: 'Example.S01E03.srt' }], show), []);
});

test('Mummy remakes, conflicting catalog IDs, and series candidates cannot pass the movie identity gate', () => {
  const right = { ...base, id: 'right', releaseName: 'The.Mummy.2026.1080p.WEB-DL-GROUP', imdbId: movie.imdbId };
  const results = finalRank([
    { ...right, id: 'wrong-id', imdbId: 'tt9999999', trusted: true },
    { ...right, id: 'wrong-year', releaseName: 'The.Mummy.2017.1080p.WEB-DL-GROUP' },
    { ...right, id: 'wrong-type', type: 'series' },
    right,
  ], movie);
  assert.deepEqual(results.map(item => item.id), ['right']);
  assert.equal(finalRank([{ ...right, imdbId: '1234567' }], movie).length, 1);
  assert.equal(finalRank([{ ...right, season: 0, episode: 0 }], movie).length, 1);
  assert.deepEqual(finalRank([{ ...right, tmdbId: 456 }], { ...movie, tmdbId: 789 }), []);
});

test('OpenSubtitles episode IDs are normalized to parent series scope, not compared to episode IMDb IDs', () => {
  const normalized = normalizeOpenSubtitlesItem({ attributes: {
    language: 'ar', release: 'Example.S01E02.WEB-DL',
    files: [{ file_id: 1 }],
    feature_details: { feature_type: 'Episode', imdb_id: 9999999, parent_imdb_id: 1234567, tmdb_id: 99, parent_tmdb_id: 42, season_number: 1, episode_number: 2 },
  } });
  assert.equal(normalized.imdbId, show.imdbId);
  assert.equal(normalized.tmdbId, 42);
  assert.equal(hasHardIdentityConflict(normalized, { ...show, tmdbId: 42 }), false);
});

test('provider FPS determines the retained duplicate before popularity or trust', () => {
  const releaseName = 'The.Mummy.2026.1080p.WEB-DL-GROUP';
  const correct = { ...base, id: 'correct', releaseName, fps: 24 };
  const wrong = { ...base, id: 'wrong', releaseName, fps: 25, downloads: 100000, trusted: true };
  const results = finalRank([wrong, correct], { ...movie, extra: { fps: 24 } });
  assert.deepEqual(results.map(item => item.id), ['correct']);
  assert.ok(scoreSubtitle(wrong, { ...movie, extra: { fps: 24 } }).releaseMatch.mismatched.includes('fps'));
});

test('technical hints do not destroy filename group or exact fingerprint', () => {
  const candidate = { ...base, releaseName: movie.filename.replace(/\.mkv$/, '') };
  const result = scoreSubtitle(candidate, { ...movie, extra: { fps: 24, videoCodec: 'HEVC', resolution: '1080p' } });
  assert.equal(result.target.releaseGroup, 'GROUP');
  assert.equal(result.target.fps, 24);
  assert.equal(result.releaseMatch.exactFingerprint, true);
  assert.ok(result.releaseMatch.matched.includes('releaseGroup'));
});

test('catalog fallback recomputes edition matching and drops stale hash/timing authority', () => {
  const extended = { ...movie, filename: 'The.Mummy.2026.Extended.1080p.WEB-DL-GROUP.mkv' };
  const cached = rankAndFilter([{ ...base, releaseName: extended.filename }], extended);
  assert.equal(cached[0].releaseMatch.tier, 6);
  assert.deepEqual(preserveAccurateCandidates(movie, cached), []);
  const oldHash = rankAndFilter([{
    ...base, id: 'old-hash', releaseName: movie.filename, movieHash: '1111111111111111', matchedByHash: true,
    sourceType: 'version-registry-exact-hash', actualTimingEvidence: { measured: true, exactVideoHash: true, verdict: 'aligned' },
  }], { ...movie, videoHash: '1111111111111111' });
  const [rebound] = preserveAccurateCandidates({ ...movie, videoHash: '2222222222222222' }, oldHash);
  assert.equal(rebound.matchedByHash, false);
  assert.equal(rebound.actualTimingEvidence, null);
  assert.ok(!rebound.scoreReasons.some(reason => /hash-match/.test(reason.reason)));
});

test('season zero survives identity, registry keys, provider queries and signed playback context', () => {
  const identity = buildVideoIdentity({ type: 'series', id: 'tt1234567:0:2', extra: { filename: 'Example.S00E02.mkv' } });
  assert.equal(identity.season, 0);
  assert.ok(versionKeys(identity).includes('episode:tt1234567:s0:e2'));
  assert.equal(new URL(buildOpenSubtitlesRequest(identity).url).searchParams.get('season_number'), '0');
  assert.equal(buildSubdlParams(identity, 'ar', 'imdb').get('season_number'), '0');
  const rows = expandSubdlSubtitles([{
    language: 'ar', url: '/pack.zip', unpack_files: [
      { name: 'Example.S00E02.srt', season: 0, episode: 2 },
      { name: 'Example.S01E02.srt', season: 1, episode: 2 },
    ],
  }], 'ar', identity);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].season, 0);
  const token = createEncodingToken({ source: { kind: 'remote', url: base.download }, context: identity });
  assert.equal(verifyEncodingToken(token).context.season, 0);
});

test('archive selects the requested episode even when another episode has substantially more Arabic cues', async () => {
  const archive = zipSync({ 'Example.S01E01.ar.srt': strToU8(srt(40)), 'Example.S01E02.ar.srt': strToU8(srt()) });
  const result = await extractSubtitlePayload(archive, { sourceName: 'Example.S01E02.ar.srt' });
  assert.equal(result.entryName, 'Example.S01E02.ar.srt');
  const preflight = await preflightSubtitleCandidate({ ...base, name: 'Example season pack' }, show, { fetcher: async () => Buffer.from(archive) });
  assert.equal(preflight.archiveEntry, 'Example.S01E02.ar.srt');
});

test('an archive containing only a different episode is rejected rather than delivered', async () => {
  const archive = zipSync({ 'Example.S01E01.ar.srt': strToU8(srt()) });
  await assert.rejects(extractSubtitlePayload(archive, { sourceName: 'pack.zip', context: show }), { status: 422 });
});

test('a README does not make a single generic subtitle ambiguous for an episode request', async () => {
  const archive = zipSync({ 'README.txt': strToU8('Read me'), 'Arabic.srt': strToU8(srt()) });
  const result = await extractSubtitlePayload(archive, { sourceName: 'pack.zip', context: show });
  assert.equal(result.entryName, 'Arabic.srt');
});

test('archive uses the matching movie release family before subtitle length', async () => {
  const archive = zipSync({
    'The.Mummy.2026.1080p.BluRay-GROUP.ar.srt': strToU8(srt(40)),
    'The.Mummy.2026.1080p.WEB-DL-GROUP.ar.srt': strToU8(srt()),
  });
  const result = await extractSubtitlePayload(archive, { sourceName: 'pack.zip', context: movie });
  assert.equal(result.entryName, 'The.Mummy.2026.1080p.WEB-DL-GROUP.ar.srt');
});
