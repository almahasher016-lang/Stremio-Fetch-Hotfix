import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasSubtitleIdentityConflict } from '../utils/scoring.js';

const corpus = JSON.parse(await readFile(new URL('./fixtures/coverage-golden.json', import.meta.url), 'utf8'));

for (const item of corpus) {
  test(`coverage golden: ${item.name}`, () => {
    assert.equal(
      hasSubtitleIdentityConflict(item.candidate, item.search),
      item.hardConflict,
      item.name,
    );
  });
}
