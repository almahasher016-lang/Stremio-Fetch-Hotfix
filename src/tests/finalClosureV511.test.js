import test from 'node:test';
import assert from 'node:assert/strict';
import { searchOpenSubtitles } from '../providers/openSubtitles.js';
import { searchYify } from '../providers/yify.js';
import { applyAccuracyPreflight, hasVerifiedAccuracyCandidate } from '../services/accuracyPreflight.js';

function osRow(id, fileId, release = `Movie.2026.1080p.WEB-DL.${id}`) {
  return {
    id: String(id),
    attributes: {
      language: 'ar',
      release,
      files: [{ file_id: fileId, file_name: `${release}.srt` }],
      feature_details: { imdb_id: 1234567, feature_type: 'movie' },
    },
  };
}

test('OpenSubtitles follows paginated search results and deduplicates files', async () => {
  const pages = [];
  const results = await searchOpenSubtitles({
    type: 'movie',
    language: 'ar',
    imdbId: 'tt1234567',
    query: '',
  }, {
    fetchJsonImpl: async url => {
      const page = Number(new URL(url).searchParams.get('page'));
      pages.push(page);
      if (page === 1) return { page: 1, total_pages: 3, data: [osRow(1, 101), osRow(2, 102)] };
      if (page === 2) return { page: 2, total_pages: 3, data: [osRow(2, 102), osRow(3, 103)] };
      return { page: 3, total_pages: 3, data: [osRow(4, 104)] };
    },
  });

  assert.deepEqual(pages, [1, 2, 3]);
  assert.deepEqual(results.map(item => item.fileId), [101, 102, 103, 104]);
});

test('YIFY movie-specific 404 is an empty result, not an outage or stale-LKG fallback', async () => {
  let lkgRead = false;
  const rows = await searchYify({ type: 'movie', imdbId: 'tt1234567', language: 'ar' }, {
    fetchTextImpl: async () => {
      const error = new Error('HTTP 404: Page not found');
      error.statusCode = 404;
      throw error;
    },
    cacheGetEntryImpl: async () => {
      lkgRead = true;
      return { value: [{ provider: 'yify', id: 'stale', download: 'https://example.test/stale.zip' }] };
    },
    cacheSetImpl: async () => {},
  });

  assert.deepEqual(rows, []);
  assert.equal(lkgRead, false);
});

test('Accuracy Preflight expands beyond the first batch when top candidates are mislabeled', async () => {
  const inspected = [];
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    provider: 'opensubtitles',
    providerId: String(index + 1),
    id: `os-${index + 1}`,
    lang: 'ara',
    releaseName: `Movie.2026.1080p.WEB-DL.GROUP${index + 1}`,
    download: `/downloads/opensubtitles/${index + 1}.srt`,
    score: 1000 - index,
  }));

  const results = await applyAccuracyPreflight(candidates, { type: 'movie', imdbId: 'tt1234567' }, {
    cacheGetImpl: async () => null,
    cacheSetImpl: async () => {},
    preflightImpl: async item => {
      inspected.push(Number(item.providerId));
      if (Number(item.providerId) <= 10) {
        return {
          quality: {
            valid: false,
            score: 72,
            reasons: ['low-arabic-ratio'],
            detectedLanguage: 'other',
            arabicRatio: 0,
            cueCount: 900,
          },
        };
      }
      return {
        quality: {
          valid: true,
          score: 100,
          reasons: [],
          detectedLanguage: 'arabic',
          arabicRatio: 0.99,
          arabicWordHits: 1000,
          persianWordHits: 0,
          cueCount: 950,
        },
      };
    },
  });

  assert.deepEqual(inspected, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(results.map(item => item.providerId), ['11', '12']);
  assert.equal(hasVerifiedAccuracyCandidate(results), true);
});

test('Accuracy Preflight never treats an uninspected candidate as a survivor', async () => {
  const candidates = Array.from({ length: 15 }, (_, index) => ({
    provider: 'opensubtitles',
    providerId: String(index + 1),
    id: `os-${index + 1}`,
    lang: 'ara',
    download: `/downloads/opensubtitles/${index + 1}.srt`,
    score: 1000 - index,
  }));

  const results = await applyAccuracyPreflight(candidates, { type: 'movie', imdbId: 'tt1234567' }, {
    cacheGetImpl: async () => null,
    cacheSetImpl: async () => {},
    preflightImpl: async item => ({
      quality: Number(item.providerId) <= 3
        ? { valid: true, score: 100, reasons: [], detectedLanguage: 'arabic', arabicRatio: 0.99, arabicWordHits: 500, cueCount: 500 }
        : { valid: false, score: 72, reasons: ['low-arabic-ratio'], detectedLanguage: 'other', arabicRatio: 0, cueCount: 500 },
    }),
  });

  assert.deepEqual(results.map(item => item.providerId), ['1', '2', '3']);
  assert.ok(results.every(item => item.accuracyPreflight?.state === 'valid'));
});
