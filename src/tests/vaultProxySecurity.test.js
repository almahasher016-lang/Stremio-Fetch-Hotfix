import test from 'node:test';
import assert from 'node:assert/strict';
import { addVaultSubtitle, deleteVaultSubtitle, searchVault } from '../services/vaultService.js';
import { resolveProxiedSubtitle, verifyEncodingToken } from '../utils/encodingProxy.js';
import { toStremioSubtitles } from '../utils/stremio.js';

function arabicSrt() {
  return Array.from({ length: 8 }, (_value, index) => {
    const start = String(index * 3).padStart(2, '0');
    const end = String(index * 3 + 2).padStart(2, '0');
    return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\nهذه ترجمة عربية من المخزن ${index + 1}\n`;
  }).join('\n');
}

test('a signed Stremio proxy resolves vault content internally', async () => {
  const item = await addVaultSubtitle({
    imdbId: 'tt6666666',
    releaseName: 'Vault.Security.1080p.WEB-DL',
    text: arabicSrt(),
  });
  try {
    const [candidate] = await searchVault({ type: 'movie', imdbId: 'tt6666666' });
    const [subtitle] = toStremioSubtitles([candidate], 'https://addon.example', {
      type: 'movie',
      id: 'tt6666666',
    });
    const match = new URL(subtitle.url).pathname.match(/^\/proxy\/encoding\/(.+)\.srt$/);
    assert.ok(match);
    const payload = verifyEncodingToken(match[1]);
    assert.equal(payload.source.kind, 'vault');
    assert.equal(payload.source.vaultId, item.id);
    assert.equal(payload.source.url, undefined);

    const resolved = await resolveProxiedSubtitle(match[1], {
      fetcher: async () => {
        throw new Error('vault resolution must not make a remote request');
      },
    });
    assert.match(resolved.text, /المخزن/);
    assert.equal(resolved.quality.valid, true);
  } finally {
    await deleteVaultSubtitle(item.id);
  }
});
