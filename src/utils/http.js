import { request } from 'undici';
import { config } from '../config.js';
import { createSafeRemoteDispatcher } from './safeRemoteUrl.js';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'api-key',
  'x-api-key',
  'x-auth-token',
  'x-admin-token',
  'x-vault-token',
  'x-registry-token',
]);
const BODY_HEADER_NAMES = new Set([
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-type',
  'transfer-encoding',
]);

function joinUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

function redirectLimitError() {
  const error = new Error('Too many redirects for upstream request');
  error.status = 502;
  error.statusCode = 502;
  return error;
}

function credentialedRedirectError() {
  const error = new Error('Cross-origin credentialed redirect is not allowed');
  error.status = 502;
  error.statusCode = 502;
  return error;
}

function destroyBody(body) {
  body?.on?.('error', () => {});
  body?.destroy?.();
}

function mergeHeaders(defaults, overrides) {
  const merged = {};
  for (const [name, value] of [...Object.entries(defaults || {}), ...Object.entries(overrides || {})]) {
    if (value === undefined || value === null) continue;
    merged[String(name).toLowerCase()] = value;
  }
  return merged;
}

function redirectRequestState({ statusCode, location, currentUrl, method, body, headers }) {
  const nextUrl = joinUrl(location, currentUrl);
  const currentOrigin = new URL(currentUrl).origin;
  const nextOrigin = new URL(nextUrl).origin;
  const crossOrigin = currentOrigin !== nextOrigin;
  const nextHeaders = mergeHeaders({}, headers);

  if (crossOrigin && Object.keys(nextHeaders).some(name => CREDENTIAL_HEADER_NAMES.has(name))) {
    throw credentialedRedirectError();
  }
  if (crossOrigin) {
    for (const name of CREDENTIAL_HEADER_NAMES) delete nextHeaders[name];
    delete nextHeaders.host;
  }

  const normalizedMethod = String(method || 'GET').toUpperCase();
  const switchToGet = statusCode === 303
    ? normalizedMethod !== 'HEAD'
    : (statusCode === 301 || statusCode === 302) && normalizedMethod === 'POST';
  if (switchToGet) {
    for (const name of BODY_HEADER_NAMES) delete nextHeaders[name];
    return { url: nextUrl, method: 'GET', body: undefined, headers: nextHeaders };
  }

  return { url: nextUrl, method, body, headers: nextHeaders };
}

function trustedTargetUrl(value, trustedOrigin) {
  if (!trustedOrigin) return null;
  try {
    const target = new URL(value);
    const trusted = new URL(trustedOrigin);
    if (
      !['https:', 'http:'].includes(target.protocol)
      || !['https:', 'http:'].includes(trusted.protocol)
      || target.username
      || target.password
      || trusted.username
      || trusted.password
      || target.origin !== trusted.origin
    ) {
      return null;
    }
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

async function readTextLimited(response, maxBytes) {
  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    destroyBody(response.body);
    const error = new Error('HTTP response is too large');
    error.statusCode = 413;
    throw error;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      destroyBody(response.body);
      const error = new Error('HTTP response is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function requestText(url, options, { maxBytes, allowPrivateNetwork, trustedOrigin }) {
  // Provider API origins are fixed by this application rather than supplied by
  // users. Let the platform resolve those origins normally; keep DNS pinning
  // for every untrusted subtitle URL and for cross-origin redirects.
  const trustedTarget = allowPrivateNetwork ? null : trustedTargetUrl(url, trustedOrigin);
  const resolved = allowPrivateNetwork || trustedTarget ? null : await createSafeRemoteDispatcher(url);
  const targetUrl = trustedTarget || resolved?.url || url;
  try {
    const response = await request(targetUrl, {
      ...options,
      ...(resolved ? { dispatcher: resolved.dispatcher } : {}),
    });
    const text = await readTextLimited(response, maxBytes);
    return { response, text, targetUrl };
  } catch (error) {
    if (error?.status || error?.name === 'AbortError') throw error;
    if (error?.statusCode === 413) error.status = 502;
    else if (!error?.statusCode) error.status = 502;
    throw error;
  } finally {
    if (resolved) {
      try {
        await resolved.dispatcher.close();
      } catch {
        // Preserve the request or response error when dispatcher shutdown also fails.
      }
    }
  }
}

export async function fetchJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = config.providers.timeoutMs,
  redirects = config.encodingProxy?.maxRedirects ?? 4,
  maxBytes = config.providers.maxResponseBytes,
  signal,
  allowPrivateNetwork = false,
  trustedOrigin,
} = {}) {
  let currentUrl = url;
  let currentHeaders = mergeHeaders({}, headers);
  for (let attempt = 0; attempt <= redirects; attempt++) {
    const { response, text, targetUrl } = await requestText(currentUrl, {
      method,
      headers: mergeHeaders({
        'user-agent': config.app.userAgent,
        accept: 'application/json',
      }, currentHeaders),
      body,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      signal,
    }, { maxBytes, allowPrivateNetwork, trustedOrigin });
    const location = response.headers.location;
    if (REDIRECT_STATUS_CODES.has(response.statusCode) && location) {
      if (attempt >= redirects) throw redirectLimitError(url);
      const next = redirectRequestState({
        statusCode: response.statusCode,
        location,
        currentUrl: targetUrl,
        method,
        body,
        headers: currentHeaders,
      });
      currentUrl = next.url;
      method = next.method;
      body = next.body;
      currentHeaders = next.headers;
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 350);
      const err = new Error(`HTTP ${response.statusCode}${snippet ? `: ${snippet}` : ''}`);
      err.status = 502;
      err.statusCode = response.statusCode;
      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }

    try {
      return text ? JSON.parse(text) : null;
    } catch (err) {
      err.message = `Invalid JSON: ${err.message}`;
      err.status = 502;
      err.statusCode = 502;
      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }
  }

  throw redirectLimitError(url);
}


export async function fetchText(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = config.providers.timeoutMs,
  redirects = config.encodingProxy?.maxRedirects ?? 4,
  maxBytes = config.providers.maxResponseBytes,
  signal,
  allowPrivateNetwork = false,
  trustedOrigin,
} = {}) {
  let currentUrl = url;
  let currentHeaders = mergeHeaders({}, headers);
  for (let attempt = 0; attempt <= redirects; attempt++) {
    const { response, text, targetUrl } = await requestText(currentUrl, {
      method,
      headers: mergeHeaders({
        'user-agent': config.app.userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
      }, currentHeaders),
      body,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      signal,
    }, { maxBytes, allowPrivateNetwork, trustedOrigin });
    const location = response.headers.location;
    if (REDIRECT_STATUS_CODES.has(response.statusCode) && location) {
      if (attempt >= redirects) throw redirectLimitError(url);
      const next = redirectRequestState({
        statusCode: response.statusCode,
        location,
        currentUrl: targetUrl,
        method,
        body,
        headers: currentHeaders,
      });
      currentUrl = next.url;
      method = next.method;
      body = next.body;
      currentHeaders = next.headers;
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 350);
      const err = new Error(`HTTP ${response.statusCode}${snippet ? `: ${snippet}` : ''}`);
      err.status = 502;
      err.statusCode = response.statusCode;
      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }
    return text;
  }
  throw redirectLimitError(url);
}
