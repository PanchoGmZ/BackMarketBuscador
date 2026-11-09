import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { acquireFixture, buildSearchUrl, createHttpAcquirer } from '../src/acquisition.js';
import { parseSearchHtml } from '../src/parser.js';
import { runSearch } from '../src/search.js';

const html = await readFile(new URL('../fixtures/iphone.html', import.meta.url), 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
const htmlResponse = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

test('construye la búsqueda nativa sin URLs arbitrarias', () => {
  const url = new URL(buildSearchUrl(' iPhone 15 Pro & '));
  assert.equal(url.origin, 'https://www.backmarket.com');
  assert.equal(url.pathname, '/en-us/search');
  assert.equal(url.searchParams.get('q'), 'iPhone 15 Pro &');
});

test('integra transporte simulado, HTML real, parser y Dataset', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  let calls = 0;
  const acquire = createHttpAcquirer({ fetchImpl: async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get('q'), 'iPhone 15 Pro');
    assert.equal(options.redirect, 'manual');
    return htmlResponse(html);
  } });
  let saved;
  const output = await runSearch({ query: 'iPhone 15 Pro', maxResults: 2 }, {
    source: async (params) => parseSearchHtml(await acquire(params), params),
    write: async (record) => { saved = record; },
  });
  assert.equal(calls, 1);
  assert.equal(output.total, 2);
  assert.equal(saved.results[0].price, 480.2);
  assert.equal(saved.results[0].priceType, 'starting_at');
  assert.match(saved.results[0].url, /^https:\/\/www\.backmarket\.com\/en-us\/p\//);
});

test('clasifica denegaciones, límite, desafíos, redirecciones y errores HTTP', async () => {
  for (const [status, code] of [[403, 'ACCESS_DENIED'], [401, 'ACCESS_DENIED'], [429, 'RATE_LIMITED'], [302, 'UNEXPECTED_REDIRECT'], [503, 'HTTP_ERROR']]) {
    const acquire = createHttpAcquirer({ fetchImpl: async () => htmlResponse('', status) });
    await assert.rejects(acquire({ query: 'x' }), { code });
  }
  const challenge = createHttpAcquirer({ fetchImpl: async () => htmlResponse('<title>Just a moment...</title>') });
  await assert.rejects(challenge({ query: 'x' }), { code: 'ACCESS_CHALLENGE' });
  const empty = createHttpAcquirer({ fetchImpl: async () => htmlResponse('  ') });
  await assert.rejects(empty({ query: 'x' }), { code: 'EMPTY_RESPONSE' });
  const network = createHttpAcquirer({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(network({ query: 'x' }), { code: 'NETWORK_ERROR' });
  const timeout = createHttpAcquirer({ timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(timeout({ query: 'x' }), { code: 'TIMEOUT' });
});

test('rechaza contenido inesperado y no consulta páginas no verificadas', async () => {
  let calls = 0;
  const acquire = createHttpAcquirer({ fetchImpl: async () => { calls++; return new Response('{}', { headers: { 'content-type': 'application/json' } }); } });
  await assert.rejects(acquire({ query: 'x', page: 2 }), { code: 'PAGE_UNVERIFIED' });
  assert.equal(calls, 0);
  await assert.rejects(acquire({ query: 'x' }), { code: 'INVALID_CONTENT_TYPE' });
  const oversized = createHttpAcquirer({ fetchImpl: async () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': '5000000' } }) });
  await assert.rejects(oversized({ query: 'x' }), { code: 'RESPONSE_TOO_LARGE' });
});

test('fixture es explícito y restringe rutas', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  assert.equal(await acquireFixture('iphone.html'), html);
  await assert.rejects(acquireFixture('../iphone.html'), { code: 'INVALID_FIXTURE' });
});

test('errores HTTP y HTML sin tarjetas no escriben resultados', async () => {
  for (const response of [htmlResponse('', 403), htmlResponse('<html><h1>Your search: iPhone 15 Pro</h1></html>')]) {
    let written = false;
    const acquire = createHttpAcquirer({ fetchImpl: async () => response });
    await assert.rejects(runSearch({ query: 'iPhone 15 Pro' }, {
      source: async (params) => parseSearchHtml(await acquire(params), params),
      write: async () => { written = true; },
    }));
    assert.equal(written, false);
  }
});
