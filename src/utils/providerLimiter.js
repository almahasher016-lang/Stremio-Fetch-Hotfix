function abortError(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

export class ProviderLimiter {
  constructor(name, {
    maxConcurrent = 2,
    minIntervalMs = 0,
    latencyThresholdMs = 3000,
    maxAdaptiveIntervalMs = 5000,
    now = () => Date.now(),
  } = {}) {
    this.name = name;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 1);
    this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
    this.latencyThresholdMs = Math.max(250, Number(latencyThresholdMs) || 3000);
    this.maxAdaptiveIntervalMs = Math.max(this.minIntervalMs, Number(maxAdaptiveIntervalMs) || 5000);
    this.now = now;
    this.active = 0;
    this.queue = [];
    this.nextStartAt = 0;
    this.blockedUntil = 0;
    this.penalty = 0;
    this.timer = null;
  }

  effectiveMaxConcurrent() {
    return this.penalty >= 2 ? 1 : this.maxConcurrent;
  }

  effectiveMinIntervalMs() {
    if (!this.penalty) return this.minIntervalMs;
    const adaptive = this.minIntervalMs + (250 * (2 ** Math.min(4, this.penalty - 1)));
    return Math.min(this.maxAdaptiveIntervalMs, adaptive);
  }

  recordOutcome({ ok, ms = 0, statusCode = 0, retryAfterMs = 0 } = {}) {
    const status = Number(statusCode) || 0;
    const duration = Math.max(0, Number(ms) || 0);
    const explicitBackoff = Math.max(0, Number(retryAfterMs) || 0);
    const overloaded = status === 429 || status >= 500;
    const slow = duration >= this.latencyThresholdMs;

    if (!ok && (overloaded || explicitBackoff > 0)) this.penalty = Math.min(6, this.penalty + 2);
    else if (!ok || slow) this.penalty = Math.min(6, this.penalty + 1);
    else if (this.penalty > 0) this.penalty -= 1;

    if (explicitBackoff > 0) {
      this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.min(explicitBackoff, 60_000));
    } else if (!ok && status === 429) {
      this.blockedUntil = Math.max(this.blockedUntil, this.now() + this.effectiveMinIntervalMs());
    }
    this.drain();
  }

  run(task, { signal } = {}) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const entry = { task, signal, resolve, reject, onAbort: null };
      entry.onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError(signal));
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      this.queue.push(entry);
      this.drain();
    });
  }

  drain() {
    const concurrency = this.effectiveMaxConcurrent();
    if (this.timer || this.active >= concurrency || !this.queue.length) return;
    const waitUntil = Math.max(this.nextStartAt, this.blockedUntil);
    const waitMs = Math.max(0, waitUntil - this.now());
    if (waitMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
      this.timer.unref?.();
      return;
    }

    const entry = this.queue.shift();
    entry.signal?.removeEventListener('abort', entry.onAbort);
    if (entry.signal?.aborted) {
      entry.reject(abortError(entry.signal));
      queueMicrotask(() => this.drain());
      return;
    }

    this.active += 1;
    this.nextStartAt = this.now() + this.effectiveMinIntervalMs();
    Promise.resolve()
      .then(entry.task)
      .then(value => {
        this.active -= 1;
        this.drain();
        entry.resolve(value);
      }, error => {
        this.active -= 1;
        this.drain();
        entry.reject(error);
      });
    if (this.active < this.effectiveMaxConcurrent()) this.drain();
  }

  status() {
    return {
      name: this.name,
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      minIntervalMs: this.minIntervalMs,
      effectiveMaxConcurrent: this.effectiveMaxConcurrent(),
      effectiveMinIntervalMs: this.effectiveMinIntervalMs(),
      adaptivePenalty: this.penalty,
      blockedUntil: this.blockedUntil || null,
    };
  }
}
