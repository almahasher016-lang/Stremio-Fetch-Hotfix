import { request } from 'undici';
import { config } from '../config.js';

function joinUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

export async function fetchJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = config.providers.timeoutMs,
  redirects = config.encodingProxy?.maxRedirects ?? 4,
} = {}) {
  let currentUrl = url;
  for (let attempt = 0; attempt <= redirects; attempt++) {
    const response = await request(currentUrl, {
      method,
      headers: {
        'user-agent': config.app.userAgent,
        accept: 'application/json',
        ...headers,
      },
      body,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

    const text = await response.body.text();
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && location && attempt < redirects) {
      currentUrl = joinUrl(location, currentUrl);
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
      err.statusCode = response.statusCode;
      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }

    try {
      return text ? JSON.parse(text) : null;
    } catch (err) {
      err.message = `Invalid JSON: ${err.message}`;
      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }
  }

  throw new Error(`Too many redirects for ${url}`);
}


export async function fetchText(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = config.providers.timeoutMs,
  redirects = config.encodingProxy?.maxRedirects ?? 4,
} = {}) {
  let currentUrl = url;
  for (let attempt = 0; attempt <= redirects; attempt++) {
    const response = await request(currentUrl, {
      method,
      headers: {
        'user-agent': config.app.userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
        ...headers,
      },
      body,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });
    const text = await response.body.text();
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && location && attempt < redirects) {
      currentUrl = joinUrl(location, currentUrl);
      if (response.statusCode === 303) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 350);
      const err = new Error(`HTTP ${response.statusCode}${snippet ? `: ${snippet}` : ''}`);
      err.statusCode = response.statusCode;
      err.body = text.slice(0, 1000);
      err.url = currentUrl;
      throw err;
    }
    return text;
  }
  throw new Error(`Too many redirects for ${url}`);
}
