import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeResults } from '../services/subtitleService.js';

test('final output boundary excludes every known machine-translation flag', () => {
  const human = { provider: 'vault', providerId: 'human', download: 'https://example.com/human.srt' };
  const results = mergeResults(
    [{ provider: 'registry', providerId: 'a', trusted: true, machineTranslated: true }],
    [{ provider: 'registry', providerId: 'b', trusted: true, automatedTranslated: true }],
    [{ provider: 'registry', providerId: 'c', trusted: true, autoTranslated: true }],
    [human],
  );
  assert.deepEqual(results, [human]);
});
