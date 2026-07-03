import test from 'node:test';
import assert from 'node:assert/strict';
import { addVaultSubtitle, searchVault, getVaultSubtitle } from '../services/vaultService.js';

test('personal vault indexes a subtitle by imdb season episode and returns provider item', async () => {
  const item = await addVaultSubtitle({
    imdbId: 'tt9999999',
    season: 1,
    episode: 2,
    releaseName: 'Example.S01E02.1080p.WEB-DL',
    text: '1\n00:00:01,000 --> 00:00:03,000\nمرحبا\n',
  });
  assert.ok(item.id);
  const stored = await getVaultSubtitle(item.id);
  assert.equal(stored.imdbId, 'tt9999999');
  const results = await searchVault({ type: 'series', imdbId: 'tt9999999', season: 1, episode: 2 });
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'vault');
  assert.ok(results[0].download.includes(item.id));
});

test('personal vault prefers exact video hash when present', async () => {
  const item = await addVaultSubtitle({
    imdbId: 'tt8888888',
    videoHash: 'ABC123HASH',
    releaseName: 'Hash.Match.1080p',
    text: '1\n00:00:01,000 --> 00:00:03,000\nاختبار\n',
  });
  const results = await searchVault({ type: 'movie', imdbId: 'tt8888888', videoHash: 'abc123hash' });
  assert.equal(results[0].providerId, item.id);
  assert.equal(results[0].searchReason, 'vault-hash');
});
