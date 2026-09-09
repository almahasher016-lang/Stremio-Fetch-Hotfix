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

test('Stremio OpenSubtitles normalizes only Arabic rows and preserves exact catalog identity', () => {
  const variant = { type: 'movie', imdbId: 'tt32612507', language: 'ar' };
  const arabic = normalizeStremioOpenSubtitlesItem({
    id: '13779830',
    url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1962346232',
    lang: 'ara',
    subtitleFileName: 'The.Mummy.2026.1080p.WEBRip.x264.srt',
    movieReleaseName: 'The.Mummy.2026.1080p.WEBRip.x264',
    fpsMilli: 23976,
  }, variant);
  assert.equal(arabic.provider, 'stremio');
  assert.equal(arabic.imdbId, 'tt32612507');
  assert.equal(arabic.lang, 'ara');
  assert.equal(arabic.fps, 23.976);
  assert.match(arabic.download, /^https:\/\/subs5\.strem\.io\//);

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

test('Stremio OpenSubtitles uses episode identity and returns only the requested language', async () => {
  const calls = [];
  const results = await searchStremioOpenSubtitles({
    type: 'series',
    imdbId: 'tt0944947',
    season: 1,
    episode: 1,
    language: 'ar',
  }, {
    configImpl,
    fetchJsonImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        subtitles: [
          { id: 'ar-1', url: 'https://subs5.strem.io/ar.srt', lang: 'ara', season: 1, episode: 1 },
          { id: 'en-1', url: 'https://subs5.strem.io/en.srt', lang: 'eng', season: 1, episode: 1 },
        ],
      };
    },
  });
  assert.equal(calls[0].url, 'https://opensubtitles-v3.strem.io/subtitles/series/tt0944947%3A1%3A1.json');
  assert.equal(calls[0].options.trustedOrigin, 'https://opensubtitles-v3.strem.io');
  assert.deepEqual(results.map(item => item.providerId), ['ar-1']);
  assert.equal(results[0].season, 1);
  assert.equal(results[0].episode, 1);
});
