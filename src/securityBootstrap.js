import { randomBytes } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { config } from './config.js';

function cspHeader(nonce) {
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
  ];
  if (config.server.isProd) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function securityMiddleware(req, res, next) {
  const nonce = randomBytes(18).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', cspHeader(nonce));
  res.setHeader('Referrer-Policy', 'no-referrer');

  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext?.traceId && /^[a-f0-9]{32}$/iu.test(spanContext.traceId)) {
    req.traceId = spanContext.traceId;
    res.setHeader('X-Trace-Id', spanContext.traceId);
  }

  return next();
}

export function cspHeaderForTests(nonce) {
  return cspHeader(nonce);
}
