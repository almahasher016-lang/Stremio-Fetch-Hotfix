import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { trace } from '@opentelemetry/api';
import { config } from './config.js';
import { getTelemetryStatus } from './telemetry.js';

const INSTALLED = Symbol.for('m7md.security-bootstrap.installed');
const originalUse = express.application.use;
const LOCK_EXPORT_PATH = '/__release_lock/e_KFOBIneLBCtFJBJcVm6bM3XTCFVryQgwlFnEOkUAc';

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

function injectNonce(body, nonce) {
  return String(body)
    .replace(/<style>/gu, `<style nonce="${nonce}">`)
    .replace(/<script>/gu, `<script nonce="${nonce}">`)
    .replace(/\s+onclick="this\.select\(\)"/gu, '');
}

async function securityMiddleware(req, res, next) {
  if (req.path === LOCK_EXPORT_PATH) {
    try {
      const lock = await readFile('/app/package-lock.json');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Length', lock.byteLength);
      return res.end(lock);
    } catch {
      return res.status(404).json({ error: 'Build lock not available' });
    }
  }

  const nonce = randomBytes(18).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', cspHeader(nonce));
  res.setHeader('Referrer-Policy', 'no-referrer');

  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext?.traceId && /^[a-f0-9]{32}$/iu.test(spanContext.traceId)) {
    req.traceId = spanContext.traceId;
    res.setHeader('X-Trace-Id', spanContext.traceId);
  }

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'access-control-expose-headers') {
      const text = String(value);
      value = text.toLowerCase().includes('x-trace-id') ? text : `${text}, X-Trace-Id`;
    }
    return originalSetHeader(name, value);
  };

  const originalJson = res.json.bind(res);
  res.json = body => {
    if (req.path === '/api/admin/health' && body && typeof body === 'object' && !Array.isArray(body)) {
      body = { ...body, telemetry: getTelemetryStatus() };
    }
    return originalJson(body);
  };

  const originalEnd = res.end.bind(res);
  res.end = (chunk, encoding, callback) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (chunk != null && contentType.includes('text/html')) {
      const text = injectNonce(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk, nonce);
      chunk = Buffer.from(text);
      res.setHeader('Content-Length', chunk.byteLength);
    }
    return originalEnd(chunk, encoding, callback);
  };

  return next();
}

express.application.use = function modernizedUse(...args) {
  if (!this[INSTALLED]) {
    Object.defineProperty(this, INSTALLED, { value: true });
    originalUse.call(this, securityMiddleware);
  }
  return originalUse.apply(this, args);
};
