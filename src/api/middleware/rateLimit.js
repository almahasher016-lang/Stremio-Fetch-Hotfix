import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_WRITE_PATH = /^\/api\/(?:admin|vault|versions|companion)(?:\/|$)/;

export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === '/health',
});

export const adminWriteLimiter = rateLimit({
  windowMs: config.rateLimit.adminWindowMs,
  max: config.rateLimit.adminMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => READ_ONLY_METHODS.has(req.method) || !ADMIN_WRITE_PATH.test(req.path),
  message: { success: false, error: 'Too many administrative write requests' },
});
