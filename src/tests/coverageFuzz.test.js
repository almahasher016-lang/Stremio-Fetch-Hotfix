import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSubtitleIdentityConflict } from '../utils/scoring.js';

const sources = ['WEB-DL', 'WEBRip', 'BluRay', 'REMUX', 'HDTV'];
const qualities = ['720p', '1080p', '2160p'];
const codecs = ['x264', 'x265', 'HEVC', 'AV1'];
const groups = ['GROUP', 'FraMeSToR', 'NTb', 'YTS', 'OTHER'];
const editions = ['', 'Directors.Cut', 'Extended', 'IMAX'];

test('movie identity survives hundreds of deterministic release mutations', () => {
  const search = {
    type: 'movie',
    imdbId: 'tt1234567',
    year: 2025,
    catalogYear: 2026,
    filename: 'Movie.2025.1080p.BluRay.REMUX-FraMeSToR.mkv',
  };

  let checked = 0;
  for (let index = 0; index < 320; index += 1) {
    const year = 2024 + (index % 4);
    const source = sources[index % sources.length];
    const quality = qualities[(index * 3) % qualities.length];
    const codec = codecs[(index * 5) % codecs.length];
    const group = groups[(index * 7) % groups.length];
    const edition = editions[(index * 11) % editions.length];
    const releaseName = ['Movie', year, quality, source, codec, edition, group].filter(Boolean).join('.');
    const candidate = {
      type: 'movie',
      imdbId: 'tt1234567',
      releaseName,
    };
    assert.equal(hasSubtitleIdentityConflict(candidate, search), false, releaseName);
    checked += 1;
  }
  assert.equal(checked, 320);
});

test('series fuzz never permits another episode or season to cross the identity boundary', () => {
  const search = {
    type: 'series',
    imdbId: 'tt0944947',
    season: 3,
    episode: 7,
    filename: 'Show.S03E07.1080p.WEB-DL.mkv',
  };

  for (let index = 1; index <= 180; index += 1) {
    const wrongSeason = index % 2 === 0 ? 4 : 3;
    let wrongEpisode = index % 2 === 0 ? 7 : ((index % 20) + 1);
    if (wrongSeason === 3 && wrongEpisode === 7) wrongEpisode = 8;
    const candidate = {
      type: 'series',
      imdbId: 'tt0944947',
      season: wrongSeason,
      episode: wrongEpisode,
      releaseName: `Show.S${String(wrongSeason).padStart(2, '0')}E${String(wrongEpisode).padStart(2, '0')}.WEB-DL`,
    };
    assert.equal(hasSubtitleIdentityConflict(candidate, search), true);
  }
});
