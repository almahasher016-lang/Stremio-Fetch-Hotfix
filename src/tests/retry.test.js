import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../utils/retry.js';

test('withRetry aborts an in-progress backoff without starting another attempt', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const task = withRetry(async () => {
    attempts += 1;
    throw new Error('temporary failure');
  }, {
    retries: 5,
    baseMs: 1_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new DOMException('deadline', 'AbortError')), 10);

  await assert.rejects(task, error => error?.name === 'AbortError');
  assert.equal(attempts, 1);
});
