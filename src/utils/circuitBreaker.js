export class CircuitBreaker {
  constructor(name, { limit = 4, resetMs = 30000 } = {}) {
    this.name = name;
    this.limit = limit;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = 0;
  }

  get open() {
    if (!this.openedAt) return false;
    if (Date.now() - this.openedAt > this.resetMs) {
      this.failures = 0;
      this.openedAt = 0;
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.limit) this.openedAt = Date.now();
  }

  status() {
    return {
      name: this.name,
      open: this.open,
      failures: this.failures,
      openedAt: this.openedAt || null,
    };
  }
}
