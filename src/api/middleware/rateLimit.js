import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { createDistributedRateLimitStore } from '../../cache/rateLimitStore.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_WRITE_PATH = /^\/api\/(?:admin|vault|versions|companion)(?:\/|$)/;
const passOnStoreError = !['0', 'false', 'no', 'off'].includes(
  String(process.env.RATE_LIMIT_PASS_ON_STORE_ERROR || 'true').toLowerCase(),
);

function storeOptions(namespace) {
  const store = createDistributedRateLimitStore(namespace);
  return store ? { store } : {};
}

export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError,
  identifier: 'public-api',
  skip: req => req.path === '/health',
  ...storeOptions('public'),
});

export const adminWriteLimiter = rateLimit({
  windowMs: config.rateLimit.adminWindowMs,
  max: config.rateLimit.adminMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError,
  identifier: 'admin-write',
  skip: req => READ_ONLY_METHODS.has(req.method) || !ADMIN_WRITE_PATH.test(req.path),
  message: { success: false, error: 'Too many administrative write requests' },
  ...storeOptions('admin-write'),
});
