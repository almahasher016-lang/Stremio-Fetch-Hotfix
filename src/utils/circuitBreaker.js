export class CircuitBreaker {
  constructor(name, {
    limit = 4,
    resetMs = 30000,
    maxResetMs = resetMs * 8,
    now = () => Date.now(),
  } = {}) {
    this.name = name;
    this.limit = limit;
    this.resetMs = resetMs;
    this.maxResetMs = Math.max(resetMs, maxResetMs);
    this.now = now;
    this.failures = 0;
    this.openedAt = 0;
    this.state = 'closed';
    this.halfOpenInFlight = false;
    this.openCount = 0;
    this.currentResetMs = resetMs;
  }

  refreshState() {
    if (this.state === 'open' && this.now() - this.openedAt >= this.currentResetMs) {
      this.state = 'half-open';
      this.halfOpenInFlight = false;
    }
  }

  get open() {
    this.refreshState();
    return this.state === 'open' || (this.state === 'half-open' && this.halfOpenInFlight);
  }

  tryAcquire() {
    this.refreshState();
    if (this.state === 'open') return false;
    if (this.state === 'half-open') {
      if (this.halfOpenInFlight) return false;
      this.halfOpenInFlight = true;
    }
    return true;
  }

  trip({ backoff = false } = {}) {
    if (backoff) this.openCount += 1;
    this.currentResetMs = Math.min(this.resetMs * (2 ** this.openCount), this.maxResetMs);
    this.state = 'open';
    this.openedAt = this.now();
    this.halfOpenInFlight = false;
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = 0;
    this.state = 'closed';
    this.halfOpenInFlight = false;
    this.openCount = 0;
    this.currentResetMs = this.resetMs;
  }

  recordFailure() {
    this.refreshState();
    if (this.state === 'open') return;
    if (this.state === 'half-open') {
      this.failures = this.limit;
      this.trip({ backoff: true });
      return;
    }
    this.failures += 1;
    if (this.failures >= this.limit) this.trip();
  }

  recordCancellation() {
    if (this.state === 'half-open') this.halfOpenInFlight = false;
  }

  reset() {
    this.recordSuccess();
  }

  status() {
    this.refreshState();
    return {
      name: this.name,
      state: this.state,
      open: this.open,
      failures: this.failures,
      openedAt: this.openedAt || null,
      retryAt: this.state === 'open' ? this.openedAt + this.currentResetMs : null,
      resetMs: this.currentResetMs,
      halfOpenInFlight: this.halfOpenInFlight,
    };
  }
}
