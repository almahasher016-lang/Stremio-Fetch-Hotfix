import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addVaultSubtitle,
  deleteVaultSubtitle,
  getVaultSubtitle,
  listVaultSubtitles,
  searchVault,
} from '../services/vaultService.js';

async function removeFixtures(imdbId) {
  const items = await listVaultSubtitles();
  for (const item of items.filter(entry => entry.imdbId === imdbId)) {
    await deleteVaultSubtitle(item.id);
  }
}

test('personal vault indexes a subtitle by imdb season episode and returns provider item', async () => {
  await removeFixtures('tt9999999');
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
  await removeFixtures('tt8888888');
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

test('personal vault rejects malformed subtitles and unsafe identifiers', async () => {
  await assert.rejects(
    addVaultSubtitle({ imdbId: 'tt7777777', text: 'not a timed subtitle' }),
    error => error?.status === 422,
  );
  await assert.rejects(
    addVaultSubtitle({
      id: '../unsafe',
      imdbId: 'tt7777777',
      text: '1\n00:00:01,000 --> 00:00:03,000\nمرحبا\n',
    }),
    error => error?.status === 400,
  );
});
