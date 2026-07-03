import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';

export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === '/health',
});
