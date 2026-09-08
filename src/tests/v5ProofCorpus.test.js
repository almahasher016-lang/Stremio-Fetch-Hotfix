import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateV5Candidates } from '../v5/shadowResolver.js';

const NOW = 1_800_000_000_000;
const corpusUrl = new URL('./fixtures/v5-proof-corpus.json', import.meta.url);

const corpus = JSON.parse(await readFile(corpusUrl, 'utf8'));

for (const fixture of corpus) {
  test(`V5 proof corpus: ${fixture.name}`, () => {
    const evaluated = evaluateV5Candidates(fixture.items, fixture.search, { now: NOW });
    assert.deepEqual(
      evaluated.map(entry => entry.proof.decision),
      fixture.expected,
    );
  });
}

test('V5 proof corpus contains both certified and failure/recovery cases', () => {
  const expected = corpus.flatMap(fixture => fixture.expected);
  assert.ok(expected.includes('certified'));
  assert.ok(expected.includes('reject'));
  assert.ok(expected.includes('recovery'));
});
