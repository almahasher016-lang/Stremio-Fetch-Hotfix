export function sleep(ms, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = String(value).trim();
  const seconds = Number(normalized);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : null;
}

function retryAfterMs(error) {
  if (Number.isFinite(Number(error?.retryAfterMs))) return Math.max(0, Number(error.retryAfterMs));
  const direct = error?.retryAfter;
  const header = error?.headers?.['retry-after']
    ?? error?.headers?.get?.('retry-after')
    ?? error?.response?.headers?.get?.('retry-after');
  return parseRetryAfter(direct ?? header);
}

export async function withRetry(fn, {
  retries = 2,
  baseMs = 250,
  maxDelayMs = 15000,
  random = Math.random,
  shouldRetry = () => true,
  signal,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (signal?.aborted || err?.name === 'AbortError' || attempt >= retries || !shouldRetry(err)) break;
      const exponential = Math.min(maxDelayMs, baseMs * (2 ** attempt));
      const jittered = Math.round((exponential / 2) + (Math.max(0, Math.min(1, random())) * exponential / 2));
      const delayMs = Math.min(maxDelayMs, Math.max(jittered, retryAfterMs(err) || 0));
      await sleep(delayMs, { signal });
    }
  }
  throw lastError;
}
