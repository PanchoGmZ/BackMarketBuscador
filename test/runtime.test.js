import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeSearch } from '../src/runtime.js';
import { resolveHttpTimeoutMs } from '../src/acquisition.js';

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
  assert.ok(!logs.lines.some((line) => line.startsWith('[TLS]')));
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
  let config; let effectiveProxyUrl; let agentOptions;
  const logs = logger();
  const proxyUrl = 'http://proxy-user:proxy-password@example.test:1234';
  const actor = { createProxyConfiguration: async (value) => { config = value; return { newUrl: async () => proxyUrl }; }, pushData: async () => {} };
  const proxyConfiguration = { useApifyProxy: true, apifyProxyGroups: ['UNBLOCKER'] };
  await executeSearch({ query: 'iPhone 15 Pro', proxyConfiguration }, { actor, log: logs, makeProxyAgent: (url, options) => { effectiveProxyUrl = url; agentOptions = options; return agent; }, fetchImpl: async (_url, options) => { assert.equal(options.dispatcher, agent); return response(html); } });
  assert.deepEqual(config, proxyConfiguration);
  assert.equal(effectiveProxyUrl, proxyUrl);
  assert.ok(logs.lines.some((line) => line.includes('grupos=UNBLOCKER')));
  assert.deepEqual(agentOptions, { requestTls: { rejectUnauthorized: false } });
  assert.ok(logs.lines.includes('[TLS] {"verified":false}'));
  assert.ok(logs.lines.some((line) => line.includes('https://www.backmarket.com/en-us/search?q=%5BREDACTED%5D')));
  assert.doesNotMatch(logs.lines.join('\n'), /proxy-password/);
  assert.equal(agent.closed, true);
});

test('presupuestos normal y diagnóstico son configurables, finitos y aplicados al HTTP', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  assert.equal(resolveHttpTimeoutMs(false, {}), 45_000);
  assert.equal(resolveHttpTimeoutMs(true, {}), 90_000);
  assert.equal(resolveHttpTimeoutMs(false, { BACKMARKET_HTTP_TIMEOUT_MS: '120' }), 120);
  assert.equal(resolveHttpTimeoutMs(true, { BACKMARKET_DIAGNOSTIC_HTTP_TIMEOUT_MS: '240' }), 240);
  assert.throws(() => resolveHttpTimeoutMs(false, { BACKMARKET_HTTP_TIMEOUT_MS: '90001' }), /BACKMARKET_HTTP_TIMEOUT_MS/);
  assert.throws(() => resolveHttpTimeoutMs(true, { BACKMARKET_DIAGNOSTIC_HTTP_TIMEOUT_MS: '0' }), /BACKMARKET_DIAGNOSTIC_HTTP_TIMEOUT_MS/);

  const run = async (diagnosticMode, delayMs, env) => {
    const logs = logger();
    const result = await executeSearch({ query: 'iPhone 15 Pro', diagnosticMode }, {
      actor: { pushData: async () => {} }, log: logs, env,
      fetchImpl: async (_url, { signal }) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        return response(html);
      },
    });
    return { result, logs };
  };

  await assert.rejects(run(false, 140, { BACKMARKET_HTTP_TIMEOUT_MS: '100' }), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.diagnostic.timeoutSource, 'local_http_abort_timer');
    return true;
  });
  const diagnostic = await run(true, 140, { BACKMARKET_DIAGNOSTIC_HTTP_TIMEOUT_MS: '250' });
  assert.equal(diagnostic.result.total, 10);
  assert.ok(diagnostic.logs.lines.some((line) => line.includes('"httpTimeoutMs":250')));
  assert.ok(diagnostic.logs.lines.some((line) => line.startsWith('[TIEMPO_HTTP]')));
  assert.ok(diagnostic.logs.lines.some((line) => line.includes('"timeoutMs":250')));
});

test('el modo fixture no se activa en Cloud', async () => {
  const saved = process.env.APIFY_IS_AT_HOME;
  try {
    process.env.APIFY_IS_AT_HOME = '1';
    await assert.rejects(executeSearch({ query: 'x' }, { actor: {}, log: logger(), fixture: 'iphone.html' }), { code: 'INVALID_MODE' });
  } finally { if (saved === undefined) delete process.env.APIFY_IS_AT_HOME; else process.env.APIFY_IS_AT_HOME = saved; }
});

test('configuración de proxy inválida conserva causa sin filtrar credenciales', async () => {
  const log = logger();
  const secret = 'not-for-logs';
  const actor = { createProxyConfiguration: async () => ({ newUrl: async () => `http://user:${secret}@proxy.test:8000` }) };
  await assert.rejects(executeSearch({ query: 'x', proxyConfiguration: { useApifyProxy: true } }, {
    actor, log, makeProxyAgent: () => { throw Object.assign(new Error(`bad password ${secret}`), { code: 'UND_ERR_INVALID_ARG' }); },
  }), (error) => {
    assert.equal(error.code, 'PROXY_ERROR');
    assert.equal(error.cause.code, 'UND_ERR_INVALID_ARG');
    assert.equal(error.diagnostic.stage, 'proxy_initialization');
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /not-for-logs/);
    return true;
  });
  assert.doesNotMatch(log.lines.join('\n'), /not-for-logs/);
});

test('el cierre del proxy no oculta el error de red principal', async () => {
  const agent = { close: async () => { throw new Error('close error'); } };
  await assert.rejects(executeSearch({ query: 'x', proxyConfiguration: { useApifyProxy: true } }, {
    actor: { createProxyConfiguration: async () => ({ newUrl: async () => 'http://user:pass@proxy.test:8000' }) },
    log: logger(), makeProxyAgent: () => agent, fetchImpl: async () => { throw Object.assign(new Error('fail'), { code: 'ECONNREFUSED' }); },
  }), { code: 'TCP_ERROR' });
});
