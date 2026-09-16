import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubdlParams, searchSubdl } from '../providers/subdl.js';

const config = {
  subdl: { apiKey: 'test', baseUrl: 'https://api.subdl.test/api/v1/subtitles', downloadBaseUrl: 'https://dl.subdl.test' },
  providers: { maxProviderItems: 30, searchFullSeason: true },
};

const episode = {
  type: 'series', title: 'House of the Dragon', query: 'House of the Dragon S02E02 BluRay',
  reason: 'coverage-source-family', imdbId: 'tt11198330', season: 2, episode: 2,
  filename: '', relaxedFallback: true,
};

test('source-family stage actually asks SubDL for the BluRay episode filename', () => {
  const params = buildSubdlParams(episode, 'ar', 'query', config);
  assert.equal(params.get('file_name'), 'House of the Dragon S02E02 BluRay');
  assert.equal(params.has('film_name'), false);
  assert.equal(params.get('season_number'), '2');
  assert.equal(params.get('episode_number'), '2');
  assert.equal(params.get('unpack'), '1');
});

test('ordinary title fallback still uses film_name and does not narrow by source', () => {
  const params = buildSubdlParams({ ...episode, reason: 'title-fallback' }, 'ar', 'query', config);
  assert.equal(params.get('film_name'), 'House of the Dragon');
  assert.equal(params.has('file_name'), false);
});

test('source-family recovery retrieves a BluRay candidate missed by title-only search', async () => {
  const urls = [];
  const results = await searchSubdl(episode, {
    configImpl: config,
    fetchJsonImpl: async url => {
      const params = new URL(url).searchParams;
      urls.push(params);
      if (params.get('file_name') !== 'House of the Dragon S02E02 BluRay') {
        return { status: true, subtitles: [] };
      }
      return {
        status: true,
        results: [{ imdb_id: 'tt11198330', type: 'tv' }],
        subtitles: [{ id: 82, language: 'ar', release_name: 'House.of.the.Dragon.S02E02.BluRay', season: 2, episode: 2, url: '/subtitle/82' }],
      };
    },
  });
  assert.ok(urls.some(params => params.get('file_name') === 'House of the Dragon S02E02 BluRay'));
  assert.equal(results.length, 1);
  assert.equal(results[0].imdbId, episode.imdbId);
  assert.match(results[0].releaseName, /BluRay/);
});

test('movie source-family searches retain BluRay when film title is shorter', () => {
  const params = buildSubdlParams({
    reason: 'coverage-source-family', type: 'movie', title: 'Tuner',
    query: 'Tuner BluRay', imdbId: 'tt33296751', relaxedFallback: true,
  }, 'ar', 'query', config);
  assert.equal(params.get('file_name'), 'Tuner BluRay');
  assert.equal(params.has('film_name'), false);
});
