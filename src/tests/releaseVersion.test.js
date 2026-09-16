import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_ID, RELEASE_NAME, RELEASE_VERSION } from '../release.js';
import { createManifest } from '../utils/stremio.js';
import { config } from '../config.js';

test('Stremio advertises the current patch release without changing its installation identity', () => {
  const manifest = createManifest();
  assert.equal(RELEASE_VERSION, '5.2.1');
  assert.equal(config.app.version, RELEASE_VERSION);
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.equal(manifest.name, RELEASE_NAME);
  assert.equal(manifest.id, RELEASE_ID);
  assert.equal(RELEASE_ID, 'community.m7md-arabic-direct-v233-private');
});
