import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, tokenOverlapScore, buildSearchVariants } from '../utils/releaseParser.js';

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
