import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSubdlBluRaySeasonPack } from '../providers/subdlSeasonPackRecovery.js';
import { searchSubdlWithV2Recovery } from '../providers/subdlV2Recovery.js';

const config = {
  subdl: { apiKey: 'fake-test-key', baseUrl: 'https://api.subdl.test/api/v1/subtitles', downloadBaseUrl: 'https://dl.subdl.test' },
  providers: { maxProviderItems: 30, searchFullSeason: true },
};
const episode = {
  type: 'series', reason: 'coverage-source-family', query: 'House of the Dragon S02E02 BluRay',
  imdbId: 'tt11198330', title: 'House of the Dragon', season: 2, episode: 2,
};
const file = (episodeNumber, extras = {}) => ({
  name: `House.of.the.Dragon.S02E${String(episodeNumber).padStart(2, '0')}.BluRay.srt`,
  season: 2, episode: episodeNumber, file_n_id: episodeNumber,
  url: `/subtitle/${episodeNumber}`,
  ...extras,
});
const pack = (extras = {}) => ({
  id: 82, lang: 'ar', season: 2,
  release_name: 'House.Of.The.Dragon.S02.1080p.Bluray.x264-BROADCAST',
  unpack_files: [file(1), file(2), file(3)],
  ...extras,
});
const response = (rows, catalog = [{ imdb_id: 'tt11198330', type: 'tv' }]) => ({
  status: true, results: catalog, subtitles: rows,
});

test('season archive query omits episode constraint and extracts ONLY verified S02E02 child', async () => {
  const calls = [];
  const results = await searchSubdlBluRaySeasonPack(episode, {
    configImpl: config,
    fetchJsonImpl: async (url, options) => {
      calls.push({ url, options });
      return response([pack(), pack({ id: 90, release_name: 'House.of.the.Dragon.S02.WEB' })]);
    },
  });
  assert.equal(calls.length, 1);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('imdb_id'), 'tt11198330');
  assert.equal(params.get('season_number'), '2');
  assert.equal(params.has('episode_number'), false);
  assert.equal(params.get('full_season'), '1');
  assert.equal(params.get('unpack'), '1');
  assert.equal(calls[0].options.trustedOrigin, config.subdl.baseUrl);
  assert.equal(results.length, 1);
  assert.equal(results[0].season, 2);
  assert.equal(results[0].episode, 2);
  assert.match(results[0].releaseName, /BluRay/i);
  assert.equal(results[0].download, 'https://dl.subdl.test/subtitle/2');
  assert.equal(results[0].matchedByHash, false);
  assert.equal(results[0].actualTimingEvidence, undefined);
});

test('reject foreign catalog, other episodes, untrusted links and archives without child files', async () => {
  const cases = [
    response([pack()], [{ imdb_id: 'tt99999999', type: 'tv' }]),
    response([pack({ unpack_files: [file(1), file(3)] })]),
    response([pack({ unpack_files: [file(2, { url: 'https://evil.example/subtitle/2' })] })]),
    response([pack({ unpack_files: [] })]),
    response([pack({ lang: 'en' })]),
    response([pack({ unpack_files: [file(2, { episode: null, name: 'unidentified.srt' })] })]),
  ];
  for (const payload of cases) {
    assert.deepEqual(await searchSubdlBluRaySeasonPack(episode, {
      configImpl: config, fetchJsonImpl: async () => payload,
    }), []);
  }
});

test('wrong distribution or absent feature does not call extra season API', async () => {
  let calls = 0;
  for (const variant of [{ ...episode, query: 'House of the Dragon WEB' }, { ...episode, type: 'movie' }, { ...episode, imdbId: null }]) {
    assert.deepEqual(await searchSubdlBluRaySeasonPack(variant, {
      configImpl: config,
      fetchJsonImpl: async () => { calls += 1; return response([pack()]); },
    }), []);
  }
  assert.equal(calls, 0);
});

test('provider finds full-season BluRay child before episode-constrained legacy lookup', async () => {
  const urls = [];
  const results = await searchSubdlWithV2Recovery(episode, {
    configImpl: config,
    fetchJsonImpl: async url => { urls.push(url); return response([pack()]); },
  });
  assert.equal(urls.length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].episode, 2);
  assert.equal(new URL(urls[0]).searchParams.has('episode_number'), false);
});

test('unavailable packs leave existing SubDL episode lookup intact', async () => {
  const urls = [];
  const results = await searchSubdlWithV2Recovery(episode, {
    configImpl: config,
    fetchJsonImpl: async url => {
      urls.push(url);
      if (!new URL(url).searchParams.has('episode_number')) return response([]);
      return response([{ id: 93, lang: 'ar', season: 2, episode: 2, release_name: 'House.of.the.Dragon.S02E02.WEB', url: '/subtitle/93' }]);
    },
  });
  assert.ok(urls.length >= 2);
  assert.ok(urls.some(url => new URL(url).searchParams.has('episode_number')));
  assert.equal(results.length, 1);
  assert.match(results[0].releaseName, /WEB/);
});
