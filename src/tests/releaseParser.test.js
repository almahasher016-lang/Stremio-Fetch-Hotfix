import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchVariants,
  normalizedStringSimilarity,
  parseRelease,
  tokenOverlapScore,
} from '../utils/releaseParser.js';

test('parseRelease extracts core video details', () => {
  const parsed = parseRelease('Movie.Name.2024.1080p.WEB-DL.x265-GROUP.mkv');
  assert.equal(parsed.quality, '1080p');
  assert.equal(parsed.source, 'web-dl');
  assert.equal(parsed.codec, 'x265');
  assert.equal(parsed.releaseGroup, 'GROUP');
  assert.equal(parsed.year, 2024);
});

test('parseRelease extracts season and episode', () => {
  const parsed = parseRelease('Show.Name.S02E07.2160p.NF.WEB-DL.x265.mkv');
  assert.equal(parsed.season, 2);
  assert.equal(parsed.episode, 7);
  assert.equal(parsed.quality, '2160p');
  assert.equal(parsed.service, 'netflix');
  assert.equal(parsed.codecFamily, 'hevc');
});

test('parseRelease normalizes modern streaming, video, audio, and frame-rate tags', () => {
  const parsed = parseRelease('Show.S01E02.2160p.AMZN.WEB-DL.DV.HDR10+.HEVC.10bit.DDP.5.1.23.976fps-FLUX.mkv');
  assert.equal(parsed.service, 'amazon');
  assert.equal(parsed.source, 'web-dl');
  assert.equal(parsed.codecFamily, 'hevc');
  assert.equal(parsed.bitDepth, '10');
  assert.equal(parsed.audioCodec, 'eac3');
  assert.equal(parsed.audioChannels, '5.1');
  assert.equal(parsed.fps, 23.976);
  assert.equal(parsed.releaseGroup, 'FLUX');
});

test('parseRelease keeps WEBRip distinct from WEB-DL for exact matching', () => {
  assert.equal(parseRelease('Movie.1080p.WEBRip.x264.mkv').source, 'webrip');
  assert.equal(parseRelease('Movie.1080p.WEB-DL.x264.mkv').source, 'web-dl');
});

test('parseRelease ignores subtitle language suffixes after the release group', () => {
  assert.equal(parseRelease('Movie.2026.1080p.WEB-DL-GROUP.ar.forced.srt').releaseGroup, 'GROUP');
});

test('parseRelease gives REMUX precedence and separates Atmos from the audio codec', () => {
  const parsed = parseRelease('Movie.2160p.BluRay.REMUX.Atmos.TrueHD7.1-GROUP.mkv');
  assert.equal(parsed.source, 'remux');
  assert.equal(parsed.audioCodec, 'truehd');
  assert.equal(parsed.audioProfile, 'atmos');
  assert.equal(parsed.audioChannels, '7.1');
});

test('parseRelease distinguishes extended, directors cut, IMAX, and remastered editions', () => {
  const extended = parseRelease('Movie.Extended.IMAX.2160p.BluRay.REMUX-GROUP.mkv');
  assert.equal(extended.edition, 'extended+imax');
  assert.deepEqual(extended.editions, ['extended', 'imax']);
  assert.equal(parseRelease("Movie.Director's.Cut.1080p.BluRay-GROUP.mkv").edition, 'directors-cut');
  assert.equal(parseRelease('Movie.Theatrical.Cut.1080p.WEB-DL-GROUP.mkv').edition, 'theatrical');
  assert.equal(parseRelease('Movie.Unrated.Remastered.1080p.BluRay-GROUP.mkv').edition, 'unrated+remastered');
});

test('normalizedStringSimilarity is deterministic and rewards near-identical releases', () => {
  const close = normalizedStringSimilarity(
    'Movie.Name.2024.1080p.AMZN.WEB-DL.x265-GROUP.mkv',
    'Movie Name 2024 1080p AMZN WEB-DL x265-GROUP.srt',
  );
  const distant = normalizedStringSimilarity(
    'Movie.Name.2024.1080p.AMZN.WEB-DL.x265-GROUP.mkv',
    'Different.Movie.2010.720p.BluRay.x264-OTHER.srt',
  );
  assert.ok(close > 0.9);
  assert.ok(close > distant);
});

test('tokenOverlapScore rewards shared release tokens', () => {
  const score = tokenOverlapScore('Show Name S01E01 1080p WEB-DL', 'Show.Name.S01E01.1080p.WEB-DL-GRP');
  assert.ok(score > 0.55);
});

test('buildSearchVariants creates multiple strong fetch variants', () => {
  const variants = buildSearchVariants({
    query: 'Example Movie', imdbId: 'tt1234567', season: 1, episode: 2, filename: 'Example.Movie.1080p.WEB-DL.mkv', type: 'movie', year: 2024,
  });
  assert.ok(variants.length >= 4);
  assert.equal(variants[0].reason, 'exact-id-file');
});
