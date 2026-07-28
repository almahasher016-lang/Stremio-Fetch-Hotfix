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

test('normalizes Companion stream facts into ranking hints', () => {
  const identity = buildVideoIdentity({
    type: 'movie',
    id: 'tt1375666',
    filename: 'Example.2160p.WEB-DL.mkv',
    fps: 23.976023,
    width: 3840,
    height: 2160,
    resolution: '2160P',
    videoCodec: 'HEVC',
    audioCodec: 'EAC3',
    audioChannels: '5.1',
    hdr: 'HDR10',
  });
  assert.equal(identity.fps, 23.976);
  assert.equal(identity.resolution, '2160p');
  assert.equal(identity.videoCodec, 'hevc');
  assert.equal(identity.extra.fps, 23.976);
  assert.equal(identity.extra.audioCodec, 'eac3');
  assert.equal(identity.extra.audioChannels, '5.1');
});
