import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { searchOpenSubtitles } from '../providers/openSubtitles.js';
import { searchSubdl } from '../providers/subdl.js';
import { searchSubsource } from '../providers/subsource.js';
import { searchYify } from '../providers/yify.js';

const LIVE_ENABLED = process.env.RUN_LIVE_PROVIDER_TESTS === '1';
const SEARCH = Object.freeze({
  type: 'movie',
  query: 'Inception',
  imdbId: 'tt1375666',
  tmdbId: 27205,
  year: 2010,
  language: 'ar',
});

function assertNormalizedResults(provider, results) {
  assert.ok(Array.isArray(results), `${provider} must return an array`);
  for (const item of results.slice(0, 10)) {
    assert.equal(item.provider, provider);
    assert.equal(typeof item.id, 'string');
    assert.ok(item.id.length > 0, `${provider} result must have an id`);
    assert.equal(item.lang, 'ara');
    assert.equal(typeof item.download, 'string');
    assert.ok(item.download.length > 0, `${provider} result must have a download reference`);
  }
}

test('live provider search contracts', {
  skip: !LIVE_ENABLED,
  timeout: 120_000,
}, async context => {
  const providers = [
    {
      name: 'opensubtitles',
      configured: Boolean(config.openSubtitles.apiKey),
      search: searchOpenSubtitles,
    },
    {
      name: 'subdl',
      configured: Boolean(config.subdl.apiKey),
      search: searchSubdl,
    },
    {
      name: 'subsource',
      configured: Boolean(config.subsource.apiKey),
      search: searchSubsource,
    },
    {
      name: 'yify',
      configured: Boolean(config.yify.enabled),
      search: searchYify,
    },
  ];

  for (const provider of providers) {
    await context.test(provider.name, {
      skip: !provider.configured,
      timeout: 45_000,
    }, async () => {
      const results = await provider.search(SEARCH);
      assertNormalizedResults(provider.name, results);
    });
  }
});
