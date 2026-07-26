import { request } from 'undici';
import { config } from '../config.js';
import { createSafeRemoteDispatcher } from './safeRemoteUrl.js';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function joinUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

function redirectLimitError(url) {
  const error = new Error(`Too many redirects for ${url}`);
  error.status = 502;
  error.statusCode = 502;
  return error;
}

function destroyBody(body) {
  body?.on?.('error', () => {});
  body?.destroy?.();
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

async function requestText(url, options, { maxBytes, allowPrivateNetwork }) {
  const resolved = allowPrivateNetwork ? null : await createSafeRemoteDispatcher(url);
  const targetUrl = resolved?.url || url;
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
} = {}) {
  let currentUrl = url;
  for (let attempt = 0; attempt <= redirects; attempt++) {
    const { response, text, targetUrl } = await requestText(currentUrl, {
      method,
      headers: {
        'user-agent': config.app.userAgent,
        accept: 'application/json',
        ...headers,
      },
      body,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      signal,
    }, { maxBytes, allowPrivateNetwork });
    const location = response.headers.location;
    if (REDIRECT_STATUS_CODES.has(response.statusCode) && location) {
      if (attempt >= redirects) throw redirectLimitError(url);
      currentUrl = joinUrl(location, targetUrl);
      // RFC behavior: 303 should continue as GET.
      if (response.statusCode === 303) {
        method = 'GET';
        body = undefined;
      }
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
} = {}) {
  let currentUrl = url;
  for (let attempt = 0; attempt <= redirects; attempt++) {
    const { response, text, targetUrl } = await requestText(currentUrl, {
      method,
      headers: {
        'user-agent': config.app.userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
        ...headers,
      },
      body,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      signal,
    }, { maxBytes, allowPrivateNetwork });
    const location = response.headers.location;
    if (REDIRECT_STATUS_CODES.has(response.statusCode) && location) {
      if (attempt >= redirects) throw redirectLimitError(url);
      currentUrl = joinUrl(location, targetUrl);
      if (response.statusCode === 303) {
        method = 'GET';
        body = undefined;
      }
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
