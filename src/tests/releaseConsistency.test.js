import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

test('release version is consistent across runtime and published artifacts', async () => {
  const [packageJson, packageLock, readme, changelog] = await Promise.all([
    readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../package-lock.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'),
  ]);
  assert.equal(config.app.version, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.match(readme, new RegExp(`v${packageJson.version.replaceAll('.', '\\.')}`));
  assert.match(changelog, new RegExp(`^## ${packageJson.version.replaceAll('.', '\\.')}`, 'm'));
});
