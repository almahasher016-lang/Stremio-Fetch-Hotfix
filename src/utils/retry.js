export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry(fn, { retries = 2, baseMs = 250, shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !shouldRetry(err)) break;
      await sleep(baseMs * Math.pow(2, attempt));
    }
  }
  throw lastError;
}
