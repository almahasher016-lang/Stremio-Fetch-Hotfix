function abortError(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

export class ProviderLimiter {
  constructor(name, {
    maxConcurrent = 2,
    minIntervalMs = 0,
    now = () => Date.now(),
  } = {}) {
    this.name = name;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 1);
    this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
    this.now = now;
    this.active = 0;
    this.queue = [];
    this.nextStartAt = 0;
    this.timer = null;
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
    if (this.timer || this.active >= this.maxConcurrent || !this.queue.length) return;
    const waitMs = Math.max(0, this.nextStartAt - this.now());
    if (waitMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
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
    this.nextStartAt = this.now() + this.minIntervalMs;
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
    if (this.active < this.maxConcurrent) this.drain();
  }

  status() {
    return {
      name: this.name,
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      minIntervalMs: this.minIntervalMs,
    };
  }
}
