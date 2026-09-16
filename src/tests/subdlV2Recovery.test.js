import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDefinitions } from '../providers/registry.js';
import { searchSubdlV2Filename, searchSubdlWithV2Recovery } from '../providers/subdlV2Recovery.js';

const config = {
  subdl: {
    apiKey: 'fake-test-key',
    baseUrl: 'https://api.subdl.test/api/v1/subtitles',
    downloadBaseUrl: 'https://dl.subdl.test',
  },
  providers: { maxProviderItems: 30, searchFullSeason: true },
};

const playback = {
  type: 'series', imdbId: 'tt11198330', title: 'House of the Dragon',
  season: 2, episode: 2, language: 'ar',
  filename: 'House.of.the.Dragon.S02E02.2160p.BluRay.REMUX-HYPERION.mkv',
};

function response(rows, extras = {}) {
  return {
    status: true,
    results: [{ imdb_id: 'tt11198330', type: 'tv' }],
    subtitles: rows,
    ...extras,
  };
}

function subtitle(id = 1, extras = {}) {
  return {
    id, lang: 'ar', season: 2, episode: 2,
    release_name: 'House.of.the.Dragon.S02E02.2160p.BluRay.REMUX-HYPERION',
    url: `/subtitle/${id}`,
    ...extras,
  };
}

test('registry routes SubDL through v2-first recovery', () => {
  assert.equal(providerDefinitions.subdl.search, searchSubdlWithV2Recovery);
});

test('v2 sends full real release filename and bearer key to pinned SubDL host', async () => {
  const calls = [];
  const results = await searchSubdlV2Filename(playback, {
    configImpl: config,
    fetchJsonImpl: async (url, options) => {
      calls.push({ url, options });
      return response([subtitle()]);
    },
  });
  assert.equal(calls.length, 1);
  const request = new URL(calls[0].url);
  assert.equal(request.origin, 'https://api.subdl.test');
  assert.equal(request.pathname, '/api/v2/files/search');
  assert.equal(request.searchParams.get('filename'), playback.filename);
  assert.equal(request.searchParams.get('languages'), 'ar');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-test-key');
  assert.equal(calls[0].options.trustedOrigin, 'https://api.subdl.test');
  assert.equal(results.length, 1);
  assert.equal(results[0].imdbId, playback.imdbId);
  assert.match(results[0].releaseName, /BluRay/);
  assert.notEqual(results[0].matchedByHash, true);
});

test('v2 rejects a wrong catalog identity despite correct-looking release title', async () => {
  const results = await searchSubdlV2Filename(playback, {
    configImpl: config,
    fetchJsonImpl: async () => response([subtitle()], {
      results: [{ imdb_id: 'tt99999999', type: 'tv' }],
    }),
  });
  assert.deepEqual(results, []);
});

test('v2 rejects explicit episode mismatch and non-Arabic or off-domain download rows', async () => {
  const rows = [
    subtitle(2, { episode: 3 }),
    subtitle(3, { lang: 'en' }),
    subtitle(4, { url: 'https://evil.example/subtitle/4' }),
    subtitle(5, { url: 'http://dl.subdl.test/subtitle/5' }),
    subtitle(6),
  ];
  const results = await searchSubdlV2Filename(playback, {
    configImpl: config,
    fetchJsonImpl: async () => response(rows),
  });
  assert.deepEqual(results.map(item => item.providerId), [6]);
});

test('v2 rejects a wrong result-level season', async () => {
  const results = await searchSubdlV2Filename(playback, {
    configImpl: config,
    fetchJsonImpl: async () => response([subtitle()], { match: { season: 1, episode: 2 } }),
  });
  assert.deepEqual(results, []);
});

test('a v2 outage preserves working v1 subtitle discovery', async () => {
  const urls = [];
  const results = await searchSubdlWithV2Recovery(playback, {
    configImpl: config,
    fetchJsonImpl: async url => {
      urls.push(url);
      if (url.includes('/api/v2/')) throw new Error('v2 unavailable');
      return response([subtitle(7, { release_name: 'House.of.the.Dragon.S02E02.WEB' })]);
    },
  });
  assert.ok(urls.some(url => url.includes('/api/v1/')));
  assert.equal(results.length, 1);
  assert.match(results[0].releaseName, /WEB/);
});

test('v2 and v1 results merge without duplicates or fabricated hash proof', async () => {
  const results = await searchSubdlWithV2Recovery(playback, {
    configImpl: config,
    fetchJsonImpl: async url => url.includes('/api/v2/')
      ? response([subtitle(8)])
      : response([subtitle(8), subtitle(9, { release_name: 'House.of.the.Dragon.S02E02.WEB' })]),
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(item => item.providerId), [8, 9]);
  assert.ok(results.every(item => item.matchedByHash !== true));
});

test('aborted v2 requests are not swallowed by the fallback', async () => {
  await assert.rejects(searchSubdlWithV2Recovery(playback, {
    configImpl: config,
    fetchJsonImpl: async url => {
      if (url.includes('/api/v2/')) throw new DOMException('request aborted', 'AbortError');
      throw new Error('v1 must not be called');
    },
  }), { name: 'AbortError' });
});
