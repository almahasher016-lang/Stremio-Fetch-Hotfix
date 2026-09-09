import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCoverageCandidates } from '../services/deepRecoveryService.js';
import { mergeCandidatePool } from '../services/subtitleService.js';

function subtitle(overrides = {}) {
  return {
    provider: 'opensubtitles',
    providerId: '1',
    id: '1',
    lang: 'ar',
    releaseName: 'Movie.2026.WEB-DL.1080p-GROUP',
    download: 'https://example.com/1.srt',
    ...overrides,
  };
}

test('coverage recovery keeps same-work candidates with release year/source differences', () => {
  const search = {
    type: 'movie',
    imdbId: 'tt1234567',
    title: 'Movie',
    year: 2025,
    catalogYear: 2026,
    filename: 'Movie.2025.BluRay.1080p.REMUX-OTHER.mkv',
  };
  const ranked = rankCoverageCandidates([
    subtitle({ imdbId: 'tt1234567' }),
  ], search);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].releaseMatch.mismatched.includes('year'));
  assert.ok(ranked[0].releaseMatch.mismatched.includes('source'));
});

test('wrong work and wrong episode remain hard rejected during rescue', () => {
  const movie = rankCoverageCandidates([
    subtitle({ imdbId: 'tt9999999' }),
  ], {
    type: 'movie',
    imdbId: 'tt1234567',
    title: 'Movie',
    filename: 'Movie.2025.WEB-DL.mkv',
  }, { rescueMode: true });
  assert.equal(movie.length, 0);

  const episode = rankCoverageCandidates([
    subtitle({
      providerId: 'episode',
      imdbId: 'tt0944947',
      releaseName: 'Game.of.Thrones.S01E03.1080p.WEB-DL',
      season: 1,
      episode: 3,
    }),
  ], {
    type: 'series',
    imdbId: 'tt0944947',
    title: 'Game of Thrones',
    season: 1,
    episode: 2,
    filename: 'Game.of.Thrones.S01E02.1080p.WEB-DL.mkv',
  }, { rescueMode: true });
  assert.equal(episode.length, 0);
});

test('hearing-impaired rows remain eligible in exhaustive recovery', () => {
  const ranked = rankCoverageCandidates([
    subtitle({ hearingImpaired: true, sdh: true }),
  ], {
    type: 'movie',
    title: 'Movie',
    year: 2026,
    filename: 'Movie.2026.WEB-DL.1080p-GROUP.mkv',
  });
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].scoreReasons.some(reason => reason.reason === 'hearing-impaired'));
});

test('machine-translated Arabic is excluded normally but survives the last-resort rescue pool', () => {
  const candidate = subtitle({ machineTranslated: true });
  const search = {
    type: 'movie',
    title: 'Movie',
    year: 2026,
    filename: 'Movie.2026.WEB-DL.1080p-GROUP.mkv',
  };
  assert.equal(rankCoverageCandidates([candidate], search).length, 0);
  const rescued = rankCoverageCandidates([candidate], search, { rescueMode: true });
  assert.equal(rescued.length, 1);
  assert.ok(rescued[0].scoreReasons.some(reason => reason.reason === 'machine-or-ai-translated'));
});

test('candidate-pool merge does not silently discard last-resort rows', () => {
  const machine = subtitle({ providerId: 'machine', id: 'machine', machineTranslated: true });
  const normal = subtitle({ providerId: 'normal', id: 'normal', download: 'https://example.com/2.srt' });
  const merged = mergeCandidatePool([machine], [normal]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some(item => item.machineTranslated));
});
