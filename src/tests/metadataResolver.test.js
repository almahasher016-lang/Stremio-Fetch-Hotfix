import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearMetadataCache,
  resolveMetadata,
} from '../services/metadataResolver.js';

const MOVIE_PAYLOAD = {
  meta: {
    id: 'tt1375666',
    name: 'Inception',
    imdb_id: 'tt1375666',
    moviedb_id: 27205,
    year: 2010,
    runtime: 148,
  },
};

function movieSearch(filename = '') {
  return {
    type: 'movie',
    id: 'tt1375666',
    filename,
  };
}

test('metadata cache preserves a newer exact release after a catalog-only lookup', async () => {
  clearMetadataCache();
  const exactFilename = 'Inception.2010.1080p.BluRay.x264-YIFY.mkv';
  let calls = 0;
  const fetchJsonImpl = async () => {
    calls += 1;
    return MOVIE_PAYLOAD;
  };

  const catalogOnly = await resolveMetadata(movieSearch(), { fetchJsonImpl });
  const exactRelease = await resolveMetadata(movieSearch(exactFilename), { fetchJsonImpl });

  assert.equal(calls, 1);
  assert.equal(catalogOnly.filename, '');
  assert.equal(exactRelease.filename, exactFilename);
  assert.equal(exactRelease.parsedRelease.quality, '1080p');
  assert.equal(exactRelease.parsedRelease.source, 'bluray');
});

test('metadata cache never leaks an earlier release into a catalog-only lookup', async () => {
  clearMetadataCache();
  const exactFilename = 'Inception.2010.2160p.WEB-DL.HEVC-GROUP.mkv';
  let calls = 0;
  const fetchJsonImpl = async () => {
    calls += 1;
    return MOVIE_PAYLOAD;
  };

  const exactRelease = await resolveMetadata(movieSearch(exactFilename), { fetchJsonImpl });
  const catalogOnly = await resolveMetadata(movieSearch(), { fetchJsonImpl });

  assert.equal(calls, 1);
  assert.equal(exactRelease.filename, exactFilename);
  assert.equal(catalogOnly.filename, '');
  assert.equal(catalogOnly.releaseFingerprint.includes('2160p'), false);
});

test('concurrent metadata lookups share one fetch without sharing request identity', async () => {
  clearMetadataCache();
  const exactFilename = 'Inception.2010.1080p.BluRay.x264-YIFY.mkv';
  let calls = 0;
  let releaseFetch;
  const fetchGate = new Promise(resolve => {
    releaseFetch = resolve;
  });
  const fetchJsonImpl = async () => {
    calls += 1;
    await fetchGate;
    return MOVIE_PAYLOAD;
  };

  const catalogPromise = resolveMetadata(movieSearch(), { fetchJsonImpl });
  const exactPromise = resolveMetadata(movieSearch(exactFilename), { fetchJsonImpl });
  releaseFetch();
  const [catalogOnly, exactRelease] = await Promise.all([catalogPromise, exactPromise]);

  assert.equal(calls, 1);
  assert.equal(catalogOnly.filename, '');
  assert.equal(exactRelease.filename, exactFilename);
});

test('cached series metadata resolves each requested episode independently', async () => {
  clearMetadataCache();
  let calls = 0;
  const fetchJsonImpl = async () => {
    calls += 1;
    return {
      meta: {
        id: 'tt0944947',
        name: 'Game of Thrones',
        imdb_id: 'tt0944947',
        videos: [
          { id: 'tt0944947:1:1', season: 1, episode: 1, name: 'Winter Is Coming', runtime: 62 },
          { id: 'tt0944947:1:2', season: 1, episode: 2, name: 'The Kingsroad', runtime: 56 },
        ],
      },
    };
  };

  const first = await resolveMetadata({
    type: 'series',
    id: 'tt0944947:1:1',
    filename: 'Game.of.Thrones.S01E01.1080p.BluRay.mkv',
  }, { fetchJsonImpl });
  const second = await resolveMetadata({
    type: 'series',
    id: 'tt0944947:1:2',
    filename: 'Game.of.Thrones.S01E02.2160p.WEB-DL.mkv',
  }, { fetchJsonImpl });

  assert.equal(calls, 1);
  assert.equal(first.episode, 1);
  assert.equal(first.title, 'Winter Is Coming');
  assert.equal(first.durationMs, 62 * 60_000);
  assert.match(first.filename, /S01E01/);
  assert.equal(second.episode, 2);
  assert.equal(second.title, 'The Kingsroad');
  assert.equal(second.durationMs, 56 * 60_000);
  assert.match(second.filename, /S01E02/);
});

test('metadata failure returns the original release identity unchanged', async () => {
  clearMetadataCache();
  const exactFilename = 'Inception.2010.1080p.BluRay.x264-YIFY.mkv';
  const resolved = await resolveMetadata(movieSearch(exactFilename), {
    fetchJsonImpl: async () => {
      throw new Error('temporary metadata outage');
    },
  });

  assert.equal(resolved.filename, exactFilename);
  assert.equal(resolved.parsedRelease.quality, '1080p');
  assert.equal(resolved.parsedRelease.source, 'bluray');
});
