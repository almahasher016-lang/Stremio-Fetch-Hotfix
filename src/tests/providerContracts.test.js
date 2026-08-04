import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenSubtitlesRequest,
  normalizeOpenSubtitlesItem,
  parseOpenSubtitlesResponse,
} from '../providers/openSubtitles.js';
import {
  buildSubdlParams,
  expandSubdlSubtitles,
  normalizeSubdlItem,
  searchSubdl,
} from '../providers/subdl.js';

const subdlConfig = Object.freeze({
  app: { userAgent: 'm7mdArabicDirect/test' },
  subdl: {
    apiKey: 'test-key',
    baseUrl: 'https://api.subdl.test/api/v1/subtitles',
    downloadBaseUrl: 'https://dl.subdl.test',
  },
  providers: {
    maxProviderItems: 10,
    searchFullSeason: true,
  },
});

test('OpenSubtitles request preserves language, identity, hash, and quality parameters', () => {
  const request = buildOpenSubtitlesRequest({
    type: 'series',
    language: 'ar',
    query: 'Person of Interest',
    imdbId: 'tt1839578',
    tmdbId: 1411,
    season: 1,
    episode: 1,
    videoHash: 'abcdef0123456789',
    videoSize: 1_234_567_890,
  });
  const url = new URL(request.url);
  assert.equal(request.expectedLanguage, 'ar');
  assert.equal(url.searchParams.get('languages'), 'ar');
  assert.equal(url.searchParams.get('type'), 'episode');
  assert.equal(url.searchParams.get('imdb_id'), '1839578');
  assert.equal(url.searchParams.get('tmdb_id'), '1411');
  assert.equal(url.searchParams.get('season_number'), '1');
  assert.equal(url.searchParams.get('episode_number'), '1');
  assert.equal(url.searchParams.get('moviehash'), 'abcdef0123456789');
  assert.equal(url.searchParams.get('moviebytesize'), '1234567890');
  assert.match(url.searchParams.get('hearing_impaired'), /^(?:exclude|include)$/);
  assert.ok(request.headers['User-Agent']);
});

test('OpenSubtitles parser preserves the normalized schema and requested language', () => {
  const arabic = {
    id: '123',
    attributes: {
      language: 'ara',
      release: 'Person.of.Interest.S01E01.720p.HDTV',
      download_count: 500,
      ratings: 8.5,
      hearing_impaired: false,
      moviehash: 'abcdef0123456789',
      moviehash_match: true,
      files: [{ file_id: 456, file_name: 'Person.of.Interest.S01E01.ar.srt' }],
      feature_details: {
        imdb_id: 1839578,
        tmdb_id: 1411,
        season_number: 1,
        episode_number: 1,
      },
    },
  };
  const english = {
    id: '124',
    attributes: {
      language: 'eng',
      files: [{ file_id: 457, file_name: 'Person.of.Interest.S01E01.en.srt' }],
    },
  };
  const direct = normalizeOpenSubtitlesItem(arabic, 'ar', { videoHash: 'abcdef0123456789' });
  assert.equal(direct.id, 'os-123');
  assert.equal(direct.fileId, 456);
  assert.equal(direct.matchedByHash, true);
  assert.equal(direct.lang, 'ara');

  const parsed = parseOpenSubtitlesResponse({ data: [arabic, english] }, 'ar', {
    videoHash: 'abcdef0123456789',
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].providerId, '123');
  assert.equal(parsed[0].download, '/downloads/opensubtitles/456.srt');
  assert.equal(parsed[0].season, 1);
  assert.equal(parsed[0].episode, 1);
  assert.equal(parsed[0].downloads, 500);
  assert.equal(parsed[0].rating, 8.5);
});

test('SubDL request keeps the documented limit, integration identity, and season unpacking', () => {
  const params = buildSubdlParams({
    type: 'series',
    imdbId: 'tt1839578',
    season: 1,
    episode: 1,
    year: 2011,
  }, 'ar', 'imdb', subdlConfig);
  assert.equal(params.get('api_key'), 'test-key');
  assert.equal(params.get('imdb_id'), 'tt1839578');
  assert.equal(params.get('languages'), 'ar');
  assert.equal(params.get('type'), 'tv');
  assert.equal(params.get('subs_per_page'), '30');
  assert.equal(params.get('client'), 'stremio');
  assert.equal(params.get('full_season'), '1');
  assert.equal(params.get('unpack'), '1');
  assert.equal(params.get('season_number'), '1');
  assert.equal(params.get('episode_number'), '1');
});

test('SubDL season packs retain only the requested episode and merge file metadata', () => {
  const rows = [{
    id: 'pack-1',
    language: 'AR',
    release_name: 'Person.of.Interest.S01.720p.HDTV',
    url: '/pack.zip',
    unpack_files: [
      { file_n_id: 'file-1', name: 'Person.of.Interest.S01E01.720p.HDTV.srt', season: '1', episode: '1', format: 'srt', size: '45678', md5: 'aaa', url: '/e01.srt' },
      { file_n_id: 'file-2', name: 'Person.of.Interest.S01E02.720p.HDTV.srt', season: '1', episode: '2', format: 'srt', size: '45679', md5: 'bbb', url: '/e02.srt' },
      { file_n_id: 'file-3', name: 'Person.of.Interest.S01E03.720p.HDTV.srt', season: '1', episode: '3', format: 'srt', size: '45680', md5: 'ccc', url: '/e03.srt' },
    ],
  }];
  const results = expandSubdlSubtitles(rows, 'ar', {
    type: 'series',
    season: 1,
    episode: 1,
  }, subdlConfig);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, 'file-1');
  assert.match(results[0].fileName, /S01E01/);
  assert.equal(results[0].format, 'srt');
  assert.equal(results[0].size, 45678);
  assert.equal(results[0].md5, 'aaa');
  assert.equal(results[0].download, 'https://dl.subdl.test/e01.srt');
});

test('SubDL filename fallback is exact and structured episode metadata takes precedence', () => {
  const base = {
    id: 'pack-2',
    language: 'ara',
    unpack_files: [
      { file_n_id: 'wanted', name: 'Show.S01E05.1080p.srt', url: '/wanted.srt' },
      { file_n_id: 'wrong-name', name: 'Show.S01E06.1080p.srt', url: '/wrong-name.srt' },
      { file_n_id: 'conflict', name: 'Show.S01E05.1080p.srt', season: 1, episode: 6, url: '/conflict.srt' },
    ],
  };
  const results = expandSubdlSubtitles([base], 'ar', {
    type: 'series',
    season: 1,
    episode: 5,
  }, subdlConfig);
  assert.deepEqual(results.map(item => item.providerId), ['wanted']);
});

test('SubDL normalization accepts unpack-file language and robust boolean flags', () => {
  const result = normalizeSubdlItem({
    file_n_id: 'file-ar',
    language_code: 'ARA',
    name: 'Show.S01E01.srt',
    url: 'Show.S01E01.srt',
    hi: '0',
    machine_translated: '1',
  }, 'ar', subdlConfig);
  assert.equal(result.lang, 'ara');
  assert.equal(result.hearingImpaired, false);
  assert.equal(result.machineTranslated, true);
  assert.equal(result.download, 'https://dl.subdl.test/Show.S01E01.srt');

  const numericFlags = normalizeSubdlItem({
    id: 'numeric-flags',
    language: 'ar',
    url: '/numeric.srt',
    hearing_impaired: 1,
    auto_translated: 'true',
  }, 'ar', subdlConfig);
  assert.equal(numericFlags.hearingImpaired, true);
  assert.equal(numericFlags.machineTranslated, true);
});

test('SubDL search preserves fallback modes and injected transport', async () => {
  const calls = [];
  const fetchJsonImpl = async url => {
    calls.push(new URL(url));
    if (calls.length === 1) throw Object.assign(new Error('temporary failure'), { statusCode: 503 });
    return {
      subtitles: [{
        id: 'subtitle-1',
        language: 'ar',
        release_name: 'Person.of.Interest.S01E01.720p.HDTV',
        url: '/subtitle-1.srt',
      }],
    };
  };
  const results = await searchSubdl({
    type: 'series',
    imdbId: 'tt1839578',
    query: 'Person of Interest',
    season: 1,
    episode: 1,
    language: 'ar',
  }, { fetchJsonImpl, configImpl: subdlConfig });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('imdb_id'), 'tt1839578');
  assert.equal(calls[1].searchParams.get('film_name'), 'Person of Interest');
  assert.equal(calls[1].searchParams.get('client'), 'stremio');
  assert.equal(results.length, 1);
  assert.equal(results[0].lang, 'ara');
});
