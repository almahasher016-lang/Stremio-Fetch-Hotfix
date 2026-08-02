import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import express from 'express';
import compression from 'compression';
import { securityMiddleware } from '../securityBootstrap.js';
import { stabilizeArabicSrt } from '../utils/arabicBidi.js';
import { stabilizeArabicStyledSubtitle } from '../utils/styledArabicBidi.js';
import {
  finalizedBodyCompressionFilter,
  sendHtmlResponse,
  sendSrtResponse,
  sendStyledSubtitleResponse,
} from '../utils/responseSenders.js';

function decodeBody(buffer, encoding) {
  if (encoding === 'gzip') return gunzipSync(buffer);
  if (encoding === 'deflate') return inflateSync(buffer);
  if (encoding === 'br') return brotliDecompressSync(buffer);
  return buffer;
}

function rawGet(baseUrl, pathname) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.get(target, { headers: { 'accept-encoding': 'gzip, deflate, br' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const encoded = Buffer.concat(chunks);
        const contentEncoding = String(response.headers['content-encoding'] || '').toLowerCase();
        try {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            encoded,
            body: decodeBody(encoded, contentEncoding),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

test('Express and compression deliver finalized SRT styled subtitles and CSP HTML without resets', async t => {
  const app = express();
  app.use(securityMiddleware);
  app.use(compression({
    threshold: 1024,
    level: 1,
    filter: (req, res) => finalizedBodyCompressionFilter(req, res, compression.filter),
  }));

  const smallSrt = '1\n00:00:01,000 --> 00:00:03,000\nمرحبا بالعالم.\n';
  const largeSrt = Array.from({ length: 100 }, (_value, index) => (
    `${index + 1}\n00:00:${String(index % 60).padStart(2, '0')},000 --> 00:00:${String((index + 2) % 60).padStart(2, '0')},000\nهذه ترجمة عربية طويلة للاختبار رقم ${index + 1}.\n`
  )).join('\n');
  const styled = `[Script Info]\nTitle: delivery\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,مرحبا بالعالم\\N'.repeat(40)}`;
  const html = `<!doctype html><html><head><style>body{font-family:system-ui}</style></head><body>${'<p>واجهة اختبار آمنة</p>'.repeat(120)}<script>window.deliveryReady=true;</script></body></html>`;

  app.get('/small.srt', (_req, res) => sendSrtResponse(res, smallSrt));
  app.get('/large.srt', (_req, res) => sendSrtResponse(res, largeSrt));
  app.get('/styled.ass', (_req, res) => sendStyledSubtitleResponse(res, styled, { format: 'ass' }));
  app.get('/page.html', (_req, res) => sendHtmlResponse(res, html));

  const server = app.listen(0);
  t.after(() => new Promise(resolve => {
    server.close(resolve);
  }));
  await new Promise(resolve => {
    server.once('listening', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const small = await rawGet(baseUrl, '/small.srt');
  assert.equal(small.status, 200);
  assert.equal(small.body.toString('utf8'), `${stabilizeArabicSrt(smallSrt).trimEnd()}\n`);

  const large = await rawGet(baseUrl, '/large.srt');
  assert.equal(large.status, 200);
  assert.ok(['br', 'gzip', 'deflate'].includes(String(large.headers['content-encoding'] || '')));
  assert.equal(large.body.toString('utf8'), `${stabilizeArabicSrt(largeSrt).trimEnd()}\n`);

  const styledResponse = await rawGet(baseUrl, '/styled.ass');
  assert.equal(styledResponse.status, 200);
  assert.equal(styledResponse.body.toString('utf8'), stabilizeArabicStyledSubtitle(styled));
  assert.match(String(styledResponse.headers['content-disposition']), /subtitle\.ass/);

  const page = await rawGet(baseUrl, '/page.html');
  assert.equal(page.status, 200);
  const pageText = page.body.toString('utf8');
  const csp = String(page.headers['content-security-policy'] || '');
  const headerNonce = csp.match(/script-src[^;]*'nonce-([^']+)'/u)?.[1];
  const scriptNonce = pageText.match(/<script nonce="([^"]+)"/u)?.[1];
  const styleNonce = pageText.match(/<style nonce="([^"]+)"/u)?.[1];
  assert.ok(headerNonce);
  assert.equal(scriptNonce, headerNonce);
  assert.equal(styleNonce, headerNonce);
  assert.match(pageText, /window\.deliveryReady=true/);
});
