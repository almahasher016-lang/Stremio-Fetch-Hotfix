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

export async function withRetry(fn, {
  retries = 2,
  baseMs = 250,
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
      await sleep(baseMs * Math.pow(2, attempt), { signal });
    }
  }
  throw lastError;
}
