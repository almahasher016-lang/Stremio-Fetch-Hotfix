import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoIdentity, normalizeStremioExtra, versionKeys } from '../utils/videoIdentity.js';

test('normalizes legacy Stremio video fields into a stable identity', () => {
  const hash = 'a1b2c3d4e5f60708';
  const extra = normalizeStremioExtra({ videoID: 'tt1375666:1:2', moviehash: hash, moviebytesize: '734003200', fileName: 'Example.S01E02.1080p.WEB-DL.mkv' });
  assert.equal(extra.videoId, 'tt1375666:1:2');
  assert.equal(extra.videoHash, hash);
  assert.equal(extra.videoSize, 734003200);

  const identity = buildVideoIdentity({ type: 'series', extra });
  assert.equal(identity.imdbId, 'tt1375666');
  assert.equal(identity.season, 1);
  assert.equal(identity.episode, 2);
  assert.equal(identity.videoHash, hash);
  assert.ok(versionKeys(identity).includes(`hash-size:${hash}:734003200`));
  assert.ok(versionKeys(identity).includes('episode:tt1375666:s1:e2'));
});

test('keeps external catalog identifiers when IMDb is unavailable', () => {
  const identity = buildVideoIdentity({ type: 'movie', id: 'kitsu:5678', filename: 'Anime.Movie.2024.1080p.mkv' });
  assert.equal(identity.kitsuId, '5678');
  assert.equal(identity.catalogId, 'kitsu:5678');
  assert.ok(versionKeys(identity).some(key => key.startsWith('movie:kitsu:5678')));
});
