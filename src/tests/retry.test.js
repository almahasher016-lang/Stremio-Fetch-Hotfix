import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, withRetry } from '../utils/retry.js';

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

test('parseRetryAfter supports seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('1.5', 0), 1500);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT', 1000), 2000);
  assert.equal(parseRetryAfter('invalid', 0), null);
});

test('withRetry retries with deterministic jitter injection', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary');
    return 'ok';
  }, {
    retries: 2,
    baseMs: 1,
    random: () => 0,
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});
