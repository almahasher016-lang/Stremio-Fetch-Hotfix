import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasStrongStremioTitleConflict,
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

const gameOfThronesVariant = Object.freeze({
  type: 'series',
  imdbId: 'tt0944947',
  season: 1,
  episode: 1,
  language: 'ar',
  title: 'Game of Thrones',
  aliases: ['Game of Thrones'],
});

function stremioRow(overrides = {}) {
  return {
    id: 'row-1',
    url: 'https://subs5.strem.io/ar.srt',
    lang: 'ara',
    season: 1,
    episode: 1,
    ...overrides,
  };
}

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

test('Stremio title guard rejects an obvious different work even when request identity matches', () => {
  const wrongWork = stremioRow({
    id: '5553272',
    movieReleaseName: 'Frozen.Planet.S01 E01.To.the.Ends.of.the.Earth.Bluray.1080p.DTS.2Audio.x264-CHD',
  });
  assert.equal(hasStrongStremioTitleConflict(wrongWork, gameOfThronesVariant), true);
  assert.equal(normalizeStremioOpenSubtitlesItem(wrongWork, gameOfThronesVariant), null);
});

test('Stremio title guard keeps a matching series release', () => {
  const matching = stremioRow({
    id: '4164853',
    movieReleaseName: 'Game.Of.Thrones.S01E01.Winter.Is.Coming.HDTV.XviD-FEVER',
  });
  assert.equal(hasStrongStremioTitleConflict(matching, gameOfThronesVariant), false);
  const normalized = normalizeStremioOpenSubtitlesItem(matching, gameOfThronesVariant);
  assert.ok(normalized);
  assert.equal(normalized.imdbId, 'tt0944947');
  assert.equal(normalized.season, 1);
  assert.equal(normalized.episode, 1);
});

test('Stremio title guard does not reject short or ambiguous release labels', () => {
  const ambiguous = stremioRow({ movieReleaseName: 'Samakawy' });
  assert.equal(hasStrongStremioTitleConflict(ambiguous, gameOfThronesVariant), false);
  assert.ok(normalizeStremioOpenSubtitlesItem(ambiguous, gameOfThronesVariant));
});

test('Stremio title guard does not reject a translated title solely for using another script', () => {
  const translated = stremioRow({ movieReleaseName: 'صراع العروش S01E01' });
  assert.equal(hasStrongStremioTitleConflict(translated, gameOfThronesVariant), false);
  assert.ok(normalizeStremioOpenSubtitlesItem(translated, gameOfThronesVariant));
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
