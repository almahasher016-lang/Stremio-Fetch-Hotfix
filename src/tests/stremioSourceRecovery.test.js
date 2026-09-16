import test from 'node:test';
import assert from 'node:assert/strict';
import { searchStremioWithSourceRecovery } from '../providers/stremioSourceRecovery.js';
import { providerDefinitions } from '../providers/registry.js';

const playback = Object.freeze({
  reason: 'exact-metadata',
  type: 'series',
  imdbId: 'tt11198330',
  season: 2,
  episode: 2,
  playbackFilename: 'House.of.the.Dragon.S02E02.2160p.UHD.BluRay.REMUX-FraMeSToR.mkv',
  playbackHash: 'cff4ef4781b1412a',
});

function row(id, releaseName) {
  return { provider: 'stremio', providerId: id, id: `stremio-${id}`, releaseName, download: `https://subs.strem.io/${id}.srt` };
}

test('registered Stremio provider uses source-family recovery', () => {
  assert.equal(providerDefinitions.stremio.search, searchStremioWithSourceRecovery);
});

test('BluRay playback recovers a catalog BluRay subtitle when targeted response only has WEB', async () => {
  const calls = [];
  const web = row('web', 'House.of.the.Dragon.S02E02.WEB-DL');
  const bluray = row('bluray', 'House.of.the.Dragon.S02E02.UHD.BluRay.REMUX');
  const result = await searchStremioWithSourceRecovery(playback, {
    maxItems: 10,
    searchImpl: async variant => {
      calls.push(variant);
      return variant.playbackFilename ? [web] : [web, bluray];
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].playbackFilename, '');
  assert.equal(calls[1].playbackHash, null);
  assert.equal(calls[1].imdbId, playback.imdbId);
  assert.deepEqual(result.map(item => item.providerId), ['bluray', 'web']);
  assert.equal(result[0].matchedByHash, undefined, 'source matching is not hash proof');
});

test('a targeted source-family result does not repeat the catalog request', async () => {
  let calls = 0;
  const bluray = row('exact-family', 'House.of.the.Dragon.S02E02.BluRay');
  const result = await searchStremioWithSourceRecovery(playback, {
    searchImpl: async () => { calls += 1; return [bluray]; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, [bluray]);
});

test('catalog recovery is restricted to metadata searches with identifiable source families', async () => {
  let calls = 0;
  const web = row('web', 'House.of.the.Dragon.S02E02.WEB-DL');
  await searchStremioWithSourceRecovery({ ...playback, reason: 'title-fallback' }, {
    searchImpl: async () => { calls += 1; return [web]; },
  });
  await searchStremioWithSourceRecovery({ ...playback, playbackFilename: '' }, {
    searchImpl: async () => { calls += 1; return [web]; },
  });
  assert.equal(calls, 2);
});

test('source-matched catalog rows get space under a provider cap without losing the original fallback', async () => {
  const result = await searchStremioWithSourceRecovery(playback, {
    maxItems: 2,
    searchImpl: async variant => variant.playbackFilename
      ? [row('web1', 'WEB-DL'), row('web2', 'WEBRip')]
      : [row('web1', 'WEB-DL'), row('disc', 'BluRay')],
  });
  assert.deepEqual(result.map(item => item.providerId), ['disc', 'web1']);
});

test('a catalog error preserves the first results, but cancellation propagates', async () => {
  const web = row('web', 'WEB-DL');
  const failedCatalog = async variant => {
    if (variant.playbackFilename) return [web];
    throw new Error('provider unavailable');
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await searchStremioWithSourceRecovery(playback, { searchImpl: failedCatalog }), [web]);
  } finally {
    console.warn = originalWarn;
  }
  await assert.rejects(
    searchStremioWithSourceRecovery(playback, {
      searchImpl: async variant => {
        if (variant.playbackFilename) return [web];
        throw new DOMException('aborted', 'AbortError');
      },
    }),
    { name: 'AbortError' },
  );
});
