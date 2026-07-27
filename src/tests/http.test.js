import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../utils/http.js';

async function withServer(handler, task) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

test('fetchJson enforces a bounded provider response size', async () => {
  await withServer((_req, res) => {
    const body = JSON.stringify({ payload: 'x'.repeat(256) });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }, async baseUrl => {
    await assert.rejects(
      fetchJson(`${baseUrl}/private`, { maxBytes: 64 }),
      error => error?.status === 400,
    );
    await assert.rejects(
      fetchJson(`${baseUrl}/large`, { maxBytes: 64, allowPrivateNetwork: true }),
      error => error?.statusCode === 413,
    );
  });
});

test('fetchJson forwards AbortSignal to the HTTP client', async () => {
  await withServer((req, res) => {
    const timer = setTimeout(() => res.end('{"ok":true}'), 1_000);
    req.on('close', () => clearTimeout(timer));
  }, async baseUrl => {
    const controller = new AbortController();
    const task = fetchJson(`${baseUrl}/slow`, { signal: controller.signal, allowPrivateNetwork: true });
    setTimeout(() => controller.abort(new DOMException('deadline', 'AbortError')), 10);
    await assert.rejects(task, error => error?.name === 'AbortError');
  });
});

test('fetchJson uses a fixed trusted provider origin without weakening redirect checks', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect-same-origin') {
      res.writeHead(302, { location: '/provider' });
      res.end();
      return;
    }
    if (req.url === '/redirect-private') {
      res.writeHead(302, { location: 'http://127.0.0.2/private' });
      res.end();
      return;
    }
    res.end('{"ok":true}');
  }, async baseUrl => {
    assert.deepEqual(
      await fetchJson(`${baseUrl}/provider`, { trustedOrigin: baseUrl }),
      { ok: true },
    );
    assert.deepEqual(
      await fetchJson(`${baseUrl}/redirect-same-origin`, { trustedOrigin: baseUrl }),
      { ok: true },
    );
    await assert.rejects(
      fetchJson(`${baseUrl}/redirect-private`, { trustedOrigin: baseUrl }),
      error => error?.status === 400,
    );
  });
});

test('fetchJson preserves credential headers across same-origin redirects', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/target' });
      res.end();
      return;
    }
    res.end(JSON.stringify({
      authorization: req.headers.authorization,
      apiKey: req.headers['api-key'],
    }));
  }, async baseUrl => {
    const result = await fetchJson(`${baseUrl}/redirect`, {
      allowPrivateNetwork: true,
      headers: {
        Authorization: 'Bearer same-origin-test',
        'Api-Key': 'same-origin-key',
      },
    });
    assert.deepEqual(result, {
      authorization: 'Bearer same-origin-test',
      apiKey: 'same-origin-key',
    });
  });
});

test('fetchJson rejects cross-origin redirects before forwarding credential headers', async () => {
  let targetRequests = 0;
  await withServer((_req, res) => {
    targetRequests += 1;
    res.end('{"unexpected":true}');
  }, async targetUrl => {
    await withServer((_req, res) => {
      res.writeHead(302, { location: `${targetUrl}/target` });
      res.end();
    }, async redirectUrl => {
      await assert.rejects(
        fetchJson(`${redirectUrl}/redirect`, {
          allowPrivateNetwork: true,
          headers: {
            Authorization: 'Bearer must-not-leak',
            'X-Api-Key': 'must-not-leak',
          },
        }),
        error => error?.status === 502 && /cross-origin credentialed redirect/i.test(error.message),
      );
      assert.equal(targetRequests, 0);
    });
  });
});

test('fetchJson converts POST to GET on a 302 redirect and removes body headers', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect') {
      req.resume();
      res.writeHead(302, { location: '/target' });
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      res.end(JSON.stringify({
        method: req.method,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: req.headers['content-type'] || null,
        contentLength: req.headers['content-length'] || null,
      }));
    });
  }, async baseUrl => {
    const result = await fetchJson(`${baseUrl}/redirect`, {
      allowPrivateNetwork: true,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      },
      body: 'payload',
    });
    assert.deepEqual(result, {
      method: 'GET',
      body: '',
      contentType: null,
      contentLength: null,
    });
  });
});

test('redirect-limit errors never include credential-bearing request URLs', async () => {
  await withServer((_req, res) => {
    res.writeHead(302, { location: '/again' });
    res.end();
  }, async baseUrl => {
    await assert.rejects(
      fetchJson(`${baseUrl}/redirect?api_key=must-not-appear`, {
        allowPrivateNetwork: true,
        redirects: 0,
      }),
      error => (
        error?.status === 502
        && !error.message.includes('must-not-appear')
        && !error.message.includes('api_key')
      ),
    );
  });
});

test('fetchJson preserves method, body, and body headers on a 307 redirect', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect') {
      req.resume();
      res.writeHead(307, { location: '/target' });
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      res.end(JSON.stringify({
        method: req.method,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: req.headers['content-type'] || null,
        contentLength: req.headers['content-length'] || null,
      }));
    });
  }, async baseUrl => {
    const result = await fetchJson(`${baseUrl}/redirect`, {
      allowPrivateNetwork: true,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      },
      body: 'payload',
    });
    assert.deepEqual(result, {
      method: 'POST',
      body: 'payload',
      contentType: 'text/plain',
      contentLength: '7',
    });
  });
});

test('fetchJson sends one case-insensitive User-Agent override', async () => {
  await withServer((req, res) => {
    const rawNames = req.rawHeaders.filter((_value, index) => index % 2 === 0);
    const userAgentCount = rawNames.filter(name => name.toLowerCase() === 'user-agent').length;
    res.end(JSON.stringify({ userAgent: req.headers['user-agent'], userAgentCount }));
  }, async baseUrl => {
    const result = await fetchJson(`${baseUrl}/headers`, {
      allowPrivateNetwork: true,
      headers: { 'User-Agent': 'provider-contract/1.0' },
    });
    assert.deepEqual(result, {
      userAgent: 'provider-contract/1.0',
      userAgentCount: 1,
    });
  });
});
