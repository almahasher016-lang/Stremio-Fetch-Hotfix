import { randomBytes } from 'node:crypto';
import express from 'express';
import { trace } from '@opentelemetry/api';
import { config } from './config.js';
import { getTelemetryStatus } from './telemetry.js';
import { stabilizeArabicSrt } from './utils/arabicBidi.js';
import {
  appendNoTransform,
  normalizeStremioSubtitleResponse,
  shouldPreserveBodyEncoding,
} from './utils/stremioResponseCompat.js';

const INSTALLED = Symbol.for('m7md.security-bootstrap.installed');
const originalUse = express.application.use;
const STREMIO_SUBTITLE_RESOURCE_RE = /^\/subtitles?\//u;
const SRT_CONTENT_TYPE_RE = /(?:application\/x-subrip|application\/srt|text\/srt)/iu;
const TEXT_SUBTITLE_CONTENT_TYPE_RE = /(?:text\/x-ssa|text\/vtt)/iu;

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

function bodyBuffer(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk ?? ''), typeof encoding === 'string' ? encoding : 'utf8');
}

function securityMiddleware(req, res, next) {
  const nonce = randomBytes(18).toString('base64');
  const preserveBodyEncoding = shouldPreserveBodyEncoding(req.path);
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', cspHeader(nonce));
  res.setHeader('Referrer-Policy', 'no-referrer');

  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext?.traceId && /^[a-f0-9]{32}$/iu.test(spanContext.traceId)) {
    req.traceId = spanContext.traceId;
    res.setHeader('X-Trace-Id', spanContext.traceId);
  }

  const originalSetHeader = res.setHeader.bind(res);
  if (preserveBodyEncoding) originalSetHeader('Cache-Control', 'no-transform');

  res.setHeader = (name, value) => {
    const normalizedName = String(name).toLowerCase();
    if (normalizedName === 'cache-control' && preserveBodyEncoding) {
      value = appendNoTransform(value);
    }
    if (normalizedName === 'access-control-expose-headers') {
      const text = String(value);
      value = text.toLowerCase().includes('x-trace-id') ? text : `${text}, X-Trace-Id`;
    }
    return originalSetHeader(name, value);
  };

  const originalJson = res.json.bind(res);
  res.json = body => {
    if (STREMIO_SUBTITLE_RESOURCE_RE.test(req.path) && body && Array.isArray(body.subtitles)) {
      body = normalizeStremioSubtitleResponse(body, config.app.version);
    }
    if (req.path === '/api/admin/health' && body && typeof body === 'object' && !Array.isArray(body)) {
      body = { ...body, telemetry: getTelemetryStatus() };
    }
    return originalJson(body);
  };

  const originalEnd = res.end.bind(res);
  res.end = (chunk, encoding, callback) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (chunk != null && SRT_CONTENT_TYPE_RE.test(contentType)) {
      let text = stabilizeArabicSrt(bodyBuffer(chunk, encoding).toString('utf8'));
      if (text && !text.endsWith('\n')) text += '\n';
      chunk = Buffer.from(text, 'utf8');
      encoding = undefined;
      originalSetHeader('Content-Disposition', 'inline; filename="m7md-arabic.srt"');
      originalSetHeader('Content-Length', chunk.byteLength);
    } else if (chunk != null && contentType.includes('text/html')) {
      const text = injectNonce(bodyBuffer(chunk, encoding).toString('utf8'), nonce);
      chunk = Buffer.from(text, 'utf8');
      encoding = undefined;
      originalSetHeader('Content-Length', chunk.byteLength);
    } else if (chunk != null && TEXT_SUBTITLE_CONTENT_TYPE_RE.test(contentType)) {
      chunk = bodyBuffer(chunk, encoding);
      encoding = undefined;
      originalSetHeader('Content-Length', chunk.byteLength);
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
