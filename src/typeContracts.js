// @ts-check

/** @typedef {{ totalHits: number, resetTime: Date }} RateLimitResult */

/** @param {RateLimitResult} value */
export function assertRateLimitResult(value) {
  return Number.isInteger(value.totalHits) && value.totalHits > 0 && value.resetTime instanceof Date;
}

/** @param {{ version: string, id: string }} app */
export function assertReleaseIdentity(app) {
  return app.version === '3.5.0' && app.id.length > 0;
}
