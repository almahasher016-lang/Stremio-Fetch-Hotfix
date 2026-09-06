import test from 'node:test';
import assert from 'node:assert/strict';
import { __availabilityKeySpecsForTests } from '../services/subtitleService.js';

test('final Arabic LKG has exact, release and catalog scopes without app-version coupling', () => {
  const specs = __availabilityKeySpecsForTests({
    type: 'series',
    id: 'tt11198330:1:7',
    season: 1,
    episode: 7,
    filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.mkv',
    videoHash: 'f6bdfb5e54ea25bf',
    videoSize: '27228198074',
  });
  assert.deepEqual(specs.map(item => item.kind), ['exact', 'release', 'catalog']);
  assert.ok(specs.every(item => item.key.startsWith('arabic-lkg:')));
  assert.ok(specs.every(item => !item.raw.includes('4.3.0')));
});
