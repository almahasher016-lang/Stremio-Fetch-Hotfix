import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../configCore.js';

test('safe defaults prioritize broad original subtitle coverage', () => {
  const config = buildConfig({});
  assert.equal(config.ranking.enableAutoSyncOption, false);
  assert.equal(config.ranking.enableReferenceAutoSync, false);
  assert.equal(config.referenceSync.enabled, false);
  assert.equal(config.providers.topN, 10);
  assert.equal(config.ranking.maxOriginalOptions, 10);
  assert.equal(config.ranking.maxStremioSubtitles, 12);
  assert.equal(config.resolver.maxProvidersPerStage, 4);
});

test('legacy sync flags cannot bypass the experimental master gate', () => {
  const blocked = buildConfig({
    ENABLE_AUTO_SYNC_OPTION: 'true',
    ENABLE_REFERENCE_AUTO_SYNC: 'true',
  });
  assert.equal(blocked.ranking.enableAutoSyncOption, false);
  assert.equal(blocked.ranking.enableReferenceAutoSync, false);
  assert.equal(blocked.referenceSync.enabled, false);

  const optedIn = buildConfig({
    ALLOW_EXPERIMENTAL_SYNC: 'true',
    ENABLE_AUTO_SYNC_OPTION: 'true',
    ENABLE_REFERENCE_AUTO_SYNC: 'true',
  });
  assert.equal(optedIn.ranking.enableAutoSyncOption, true);
  assert.equal(optedIn.ranking.enableReferenceAutoSync, true);
  assert.equal(optedIn.referenceSync.enabled, true);
});
