import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPlan } from '../services/searchPlanner.js';
import { buildOpenSubtitlesRequest } from '../providers/openSubtitles.js';
import { applyAccuracyPreflight } from '../services/accuracyPreflight.js';

const definitions = {
  opensubtitles: {
    name: 'opensubtitles',
    configured: () => true,
    supports: { movie: true, series: true, hash: true, reference: true },
  },
};

test('metadata and fallback plans do not over-constrain providers with title plus IDs', () => {
  const plan = createSearchPlan({
    type: 'movie',
    imdbId: 'tt11561116',
    tmdbId: 123,
    title: 'The Whisper Man',
    filename: 'The.Whisper.Man.2026.2160p.WEB-DL.mkv',
    aliases: ['Whisper Man'],
  }, definitions, ['opensubtitles'], { includeHash: false });

  const exact = plan.find(stage => stage.name === 'exact-metadata').variants[0];
  assert.equal(exact.query, '');
  assert.equal(exact.filename, '');
  assert.equal(exact.imdbId, 'tt11561116');

  const release = plan.find(stage => stage.name === 'release-fallback').variants[0];
  assert.equal(release.imdbId, null);
  assert.equal(release.tmdbId, null);
  assert.match(release.query, /Whisper\.Man/);

  const title = plan.find(stage => stage.name === 'title-fallback').variants[0];
  assert.equal(title.imdbId, null);
  assert.equal(title.tmdbId, null);
  assert.equal(title.query, 'The Whisper Man');

  const alias = plan.find(stage => stage.name === 'alias-fallback').variants[0];
  assert.equal(alias.query, 'Whisper Man');
});

test('OpenSubtitles recovery includes hearing-impaired results only for relaxed fallback', () => {
  const strict = new URL(buildOpenSubtitlesRequest({ type: 'movie', language: 'ar', imdbId: 'tt11561116' }).url);
  const relaxed = new URL(buildOpenSubtitlesRequest({ type: 'movie', language: 'ar', imdbId: 'tt11561116', relaxedFallback: true }).url);
  assert.equal(strict.searchParams.get('hearing_impaired'), 'exclude');
  assert.equal(relaxed.searchParams.get('hearing_impaired'), 'include');
});

test('measured preflight quality participates in final ordering', async () => {
  const results = [
    { provider: 'subdl', id: 'a', providerId: 'a', lang: 'ar', releaseName: 'Movie.2026.WEB-DL', download: 'https://example.com/a.srt', score: 500 },
    { provider: 'subdl', id: 'b', providerId: 'b', lang: 'ar', releaseName: 'Movie.2026.WEB-DL', download: 'https://example.com/b.srt', score: 500 },
  ];
  const outcomes = new Map([
    ['https://example.com/a.srt', { quality: { valid: true, score: 45, reasons: [] }, encoding: 'utf-8', format: 'srt' }],
    ['https://example.com/b.srt', { quality: { valid: true, score: 96, reasons: [] }, encoding: 'utf-8', format: 'srt' }],
  ]);
  const ranked = await applyAccuracyPreflight(results, { filename: 'Movie.2026.WEB-DL.mkv' }, {
    preflightImpl: async item => outcomes.get(item.download),
    cacheGetImpl: async () => null,
    cacheSetImpl: async () => {},
  });
  assert.equal(ranked[0].id, 'b');
  assert.equal(ranked[0].quality.score, 96);
});
