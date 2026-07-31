import { stabilizeArabicSrt } from './arabicBidi.js';

const FINALIZED_BODY = Symbol.for('m7md.response.body-finalized');
const FINALIZED_TEXT_CONTENT_RE = /^(?:text\/html|text\/x-ssa|text\/vtt|application\/(?:x-subrip|srt))/iu;

function responseNonce(res) {
  const nonce = String(res.locals?.cspNonce || '');
  if (!nonce) throw new Error('CSP nonce is missing from res.locals');
  const csp = String(res.getHeader('Content-Security-Policy') || '');
  if (!csp.includes(`'nonce-${nonce}'`)) {
    throw new Error('CSP nonce does not match the response header');
  }
  return nonce;
}

export function injectCspNonce(html, nonce) {
  return String(html || '')
    .replace(/<style(?![^>]*\bnonce=)([^>]*)>/giu, `<style nonce="${nonce}"$1>`)
    .replace(/<script(?![^>]*\bnonce=)([^>]*)>/giu, `<script nonce="${nonce}"$1>`)
    .replace(/\s+onclick="this\.select\(\)"/giu, '');
}

export function markResponseBodyFinalized(res) {
  res.locals[FINALIZED_BODY] = true;
}

export function isResponseBodyFinalized(res) {
  return Boolean(res.locals?.[FINALIZED_BODY]);
}

export function finalizedBodyCompressionFilter(req, res, defaultFilter) {
  const contentType = String(res.getHeader('Content-Type') || '');
  if (FINALIZED_TEXT_CONTENT_RE.test(contentType) && !isResponseBodyFinalized(res)) return false;
  return defaultFilter(req, res);
}

export function sendHtmlResponse(res, html, {
  cacheControl = 'no-cache',
  status = 200,
} = {}) {
  const nonce = responseNonce(res);
  const body = Buffer.from(injectCspNonce(html, nonce), 'utf8');
  markResponseBodyFinalized(res);
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  return res.send(body);
}

export function sendSrtResponse(res, text, {
  cacheControl = 'public, max-age=86400',
  filename = 'm7md-arabic.srt',
} = {}) {
  let stabilized = stabilizeArabicSrt(String(text || ''));
  if (stabilized && !stabilized.endsWith('\n')) stabilized += '\n';
  const body = Buffer.from(stabilized, 'utf8');
  markResponseBodyFinalized(res);
  res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', cacheControl);
  return res.send(body);
}

export function sendStyledSubtitleResponse(res, text, {
  cacheControl = 'public, max-age=86400',
  format = 'ass',
} = {}) {
  const safeFormat = String(format || '').toLowerCase() === 'ssa' ? 'ssa' : 'ass';
  const body = Buffer.from(String(text || ''), 'utf8');
  markResponseBodyFinalized(res);
  res.setHeader('Content-Type', 'text/x-ssa; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="subtitle.${safeFormat}"`);
  res.setHeader('Cache-Control', cacheControl);
  return res.send(body);
}
