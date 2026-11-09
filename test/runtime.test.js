import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeSearch } from '../src/runtime.js';

const html = await readFile(new URL('../fixtures/iphone.html', import.meta.url), 'utf8').catch((err) => { if (err.code === 'ENOENT') return null; throw err; });
const logger = () => { const lines = []; return { lines, info: (line) => lines.push(line) }; };
const response = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('flujo live simulado guarda Dataset desde HTML real y sin fallback', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const logs = logger(); let saved; let calls = 0;
  const output = await executeSearch({ query: 'iPhone 15 Pro', maxResults: 2, diagnosticMode: true }, {
    actor: { pushData: async (item) => { saved = item; } }, log: logs,
    fetchImpl: async (url, options) => { calls++; assert.equal(new URL(url).searchParams.get('q'), 'iPhone 15 Pro'); assert.equal(options.redirect, 'manual'); return response(html); },
  });
  assert.equal(calls, 1);
  assert.equal(output.total, 2);
  assert.deepEqual(output, saved);
  assert.equal(saved.results[0].priceType, 'starting_at');
  for (const marker of ['[INICIO]', '[PROXY]', '[NAVEGACION]', '[HTTP]', '[HTML_LISTO]', '[PRODUCTOS_ENCONTRADOS]', '[GUARDADO]', '[FIN]']) assert.ok(logs.lines.some((line) => line.includes(marker)), marker);
});

test('403, 429, red y 301 terminan sin escribir ni reintentar', async () => {
  for (const [status, code] of [[403, 'ACCESS_DENIED'], [429, 'RATE_LIMITED'], [301, 'UNEXPECTED_REDIRECT'], [0, 'NETWORK_ERROR']]) {
    let calls = 0; let written = false;
    await assert.rejects(executeSearch({ query: 'x' }, { actor: { pushData: () => { written = true; } }, log: logger(), fetchImpl: async () => { calls++; if (!status) throw new Error('offline'); return response('', status); } }), { code });
    assert.equal(written, false);
    assert.equal(calls, 1);
  }
});

test('el proxy oficial se conecta al transporte y se cierra', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const agent = { closed: false, async close() { this.closed = true; } };
  let config;
  const actor = { createProxyConfiguration: async (value) => { config = value; return { newUrl: async () => 'http://example.test:1234' }; }, pushData: async () => {} };
  const proxyConfiguration = { useApifyProxy: true };
  await executeSearch({ query: 'iPhone 15 Pro', proxyConfiguration }, { actor, log: logger(), makeProxyAgent: () => agent, fetchImpl: async (_url, options) => { assert.equal(options.dispatcher, agent); return response(html); } });
  assert.deepEqual(config, proxyConfiguration);
  assert.equal(agent.closed, true);
});

test('el modo fixture no se activa en Cloud', async () => {
  const saved = process.env.APIFY_IS_AT_HOME;
  try {
    process.env.APIFY_IS_AT_HOME = '1';
    await assert.rejects(executeSearch({ query: 'x' }, { actor: {}, log: logger(), fixture: 'iphone.html' }), { code: 'INVALID_MODE' });
  } finally { if (saved === undefined) delete process.env.APIFY_IS_AT_HOME; else process.env.APIFY_IS_AT_HOME = saved; }
});
