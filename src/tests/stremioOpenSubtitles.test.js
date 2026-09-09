import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStremioOpenSubtitlesItem,
  searchStremioOpenSubtitles,
} from '../providers/stremioOpenSubtitles.js';

const configImpl = Object.freeze({
  stremioOpenSubtitles: {
    enabled: true,
    baseUrl: 'https://opensubtitles-v3.strem.io',
  },
  providers: { maxProviderItems: 10 },
});

test('Stremio OpenSubtitles preserves row identity without manufacturing catalog identity from the query', () => {
  const variant = { type: 'movie', imdbId: 'tt32612507', title: 'The Mummy', language: 'ar' };
  const arabic = normalizeStremioOpenSubtitlesItem({
    id: '13779830',
    imdbId: 'tt32612507',
    url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1962346232',
    lang: 'ara',
    subtitleFileName: 'The.Mummy.2026.1080p.WEBRip.x264.srt',
    movieReleaseName: 'The.Mummy.2026.1080p.WEBRip.x264',
    fpsMilli: 23976,
  }, variant);
  assert.equal(arabic.provider, 'stremio');
  assert.equal(arabic.imdbId, 'tt32612507');
  assert.equal(arabic.searchCatalogId, 'tt32612507');
  assert.equal(arabic.lang, 'ara');
  assert.equal(arabic.fps, 23.976);
  assert.match(arabic.download, /^https:\/\/subs5\.strem\.io\//);

  const noRowIdentity = normalizeStremioOpenSubtitlesItem({
    id: 'no-row-id',
    url: 'https://subs5.strem.io/no-row-id.srt',
    lang: 'ara',
    subtitleFileName: 'The.Mummy.2026.1080p.WEBRip.x264.srt',
  }, variant);
  assert.equal(noRowIdentity.imdbId, null);
  assert.equal(noRowIdentity.searchCatalogId, 'tt32612507');

  assert.equal(normalizeStremioOpenSubtitlesItem({
    id: 'english',
    url: 'https://subs5.strem.io/example',
    lang: 'eng',
  }, variant), null);
});

test('Stremio OpenSubtitles rejects download URLs outside the Stremio domain', () => {
  assert.equal(normalizeStremioOpenSubtitlesItem({
    id: 'unsafe',
    url: 'https://example.com/subtitle.srt',
    lang: 'ara',
  }, { type: 'movie', imdbId: 'tt32612507', language: 'ar' }), null);
});

test('Stremio OpenSubtitles infers requested episode from the row release name without copying query identity', async () => {
  const calls = [];
  const results = await searchStremioOpenSubtitles({
    type: 'series',
    imdbId: 'tt0944947',
    title: 'Game of Thrones',
    aliases: ['Game Of Thrones'],
    season: 1,
    episode: 1,
    language: 'ar',
  }, {
    configImpl,
    fetchJsonImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        subtitles: [
          {
            id: 'ar-1',
            url: 'https://subs5.strem.io/ar.srt',
            lang: 'ara',
            movieReleaseName: 'Game.Of.Thrones.S01E01.Winter.Is.Coming.HDTV.XviD-FEVER',
          },
          {
            id: 'en-1',
            url: 'https://subs5.strem.io/en.srt',
            lang: 'eng',
            movieReleaseName: 'Game.Of.Thrones.S01E01.HDTV',
          },
        ],
      };
    },
  });
  assert.equal(calls[0].url, 'https://opensubtitles-v3.strem.io/subtitles/series/tt0944947%3A1%3A1.json');
  assert.equal(calls[0].options.trustedOrigin, 'https://opensubtitles-v3.strem.io');
  assert.deepEqual(results.map(item => item.providerId), ['ar-1']);
  assert.equal(results[0].imdbId, null);
  assert.equal(results[0].searchCatalogId, 'tt0944947');
  assert.equal(results[0].season, 1);
  assert.equal(results[0].episode, 1);
});

test('Stremio OpenSubtitles rejects a clearly different series returned for the same episode coordinates', () => {
  const variant = {
    type: 'series',
    imdbId: 'tt0944947',
    title: 'Game of Thrones',
    aliases: ['Game Of Thrones'],
    season: 1,
    episode: 1,
    language: 'ar',
  };

  const correct = normalizeStremioOpenSubtitlesItem({
    id: 'got',
    url: 'https://subs5.strem.io/got.srt',
    lang: 'ara',
    movieReleaseName: 'Game.Of.Thrones.S01E01.Winter.Is.Coming.HDTV.XviD-FEVER',
  }, variant);
  assert.ok(correct);
  assert.equal(correct.season, 1);
  assert.equal(correct.episode, 1);

  const polluted = normalizeStremioOpenSubtitlesItem({
    id: 'frozen-planet',
    url: 'https://subs5.strem.io/frozen.srt',
    lang: 'ara',
    movieReleaseName: 'Frozen.Planet.S01E01.To.the.Ends.of.the.Earth.Bluray.1080p.DTS.x264-CHD',
  }, variant);
  assert.equal(polluted, null);
});
