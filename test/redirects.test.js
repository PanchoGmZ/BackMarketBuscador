import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHttpAcquirer } from '../src/acquisition.js';
import { executeSearch } from '../src/runtime.js';
const redirect = (location, status = 301) => new Response('', { status, headers: { location } });
const ok = () => new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } });

test('GET directo sigue 301/302/303/307/308, cancela cuerpos y conserva q', async () => {
  const statuses = [301, 302, 303, 307, 308]; let calls = 0; let signal; const seen = [];
  const acquire = createHttpAcquirer({ followDirectRedirects: true, onHttp: (status) => seen.push(status), fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('q'), 'iphone 13');
    assert.equal(options.redirect, 'manual');
    if (signal) assert.equal(options.signal, signal); else signal = options.signal;
    if (calls === statuses.length) return ok();
    const i = calls++;
    return redirect(i % 2 ? `https://backmarket.com/en-us/search?step=${i}` : `/en-us/search/?step=${i}`, statuses[i]);
  } });
  assert.equal(await acquire({ query: 'iphone 13' }), '<html>ok</html>');
  assert.deepEqual(seen, [...statuses, 200]);
});

test('rechaza destinos ajenos, internos, credenciales y rutas inesperadas antes de solicitar', async () => {
  for (const location of ['https://evil.test/', 'https://127.0.0.1/', 'http://www.backmarket.com/en-us/search', 'https://user:secret@www.backmarket.com/en-us/search', 'https://www.backmarket.com:8443/en-us/search', '/login', 'https://www.backmarket.com.evil.test/en-us/search']) {
    let calls = 0;
    await assert.rejects(createHttpAcquirer({ followDirectRedirects: true, fetchImpl: async () => { calls++; return redirect(location); } })({ query: 'x' }), { code: 'UNSAFE_REDIRECT' });
    assert.equal(calls, 1);
  }
});

test('limita saltos, detecta bucles y mantiene denegaciones HTTP', async () => {
  let calls = 0;
  await assert.rejects(createHttpAcquirer({ followDirectRedirects: true, fetchImpl: async () => redirect(`/en-us/search?step=${calls++}`) })({ query: 'x' }), { code: 'TOO_MANY_REDIRECTS' });
  assert.equal(calls, 6);
  await assert.rejects(createHttpAcquirer({ followDirectRedirects: true, fetchImpl: async () => redirect('/en-us/search?q=x') })({ query: 'x' }), { code: 'REDIRECT_LOOP' });
  for (const [status, code] of [[403, 'ACCESS_DENIED'], [429, 'RATE_LIMITED'], [502, 'HTTP_ERROR']]) {
    let count = 0;
    await assert.rejects(createHttpAcquirer({ followDirectRedirects: true, fetchImpl: async () => count++ ? new Response('', { status }) : redirect('/en-us/search/') })({ query: 'x' }), { code });
    assert.equal(count, 2);
  }
});

test('el presupuesto temporal es compartido por todos los saltos', async () => {
  let calls = 0;
  await assert.rejects(createHttpAcquirer({ followDirectRedirects: true, timeoutMs: 70, fetchImpl: async (_url, { signal }) => {
    await new Promise((resolve) => setTimeout(resolve, 45));
    signal.throwIfAborted();
    return redirect(`/en-us/search?step=${calls++}`);
  } })({ query: 'x' }), { code: 'TIMEOUT' });
  assert.equal(calls, 1);
});

test('Cloud predeterminado conserva UNBLOCKER, TLS y rechazo de redirecciones', async () => {
  let calls = 0; let closed = false;
  const agent = { close: async () => { closed = true; } };
  await assert.rejects(executeSearch({ query: 'x' }, {
    actor: { createProxyConfiguration: async (config) => {
      assert.deepEqual(config, { useApifyProxy: true, apifyProxyGroups: ['UNBLOCKER'] });
      return { newUrl: async () => 'http://user:pass@proxy.test:8000' };
    } }, log: { info() {} },
    makeProxyAgent: (_url, options) => { assert.deepEqual(options, { requestTls: { rejectUnauthorized: false } }); return agent; },
    fetchImpl: async (_url, options) => { calls++; assert.equal(options.dispatcher, agent); return redirect('/en-us/search/'); },
  }), { code: 'UNEXPECTED_REDIRECT' });
  assert.equal(calls, 1); assert.equal(closed, true);
});

const html = await readFile(new URL('../fixtures/iphone.html', import.meta.url), 'utf8').catch(() => null);
test('directo no llama al SDK de proxy; redirección y HTML real llegan al Dataset', { skip: !html }, async () => {
  let saved; let calls = 0; const logs = [];
  const result = await executeSearch({ query: 'iPhone 15 Pro', maxResults: 3, proxyConfiguration: { useApifyProxy: false } }, {
    actor: { createProxyConfiguration() { assert.fail('No se debe llamar al SDK de proxy'); }, pushData: async (item) => { saved = item; } },
    makeProxyAgent() { assert.fail('No se debe crear ProxyAgent'); }, log: { info: (line) => logs.push(line) },
    fetchImpl: async (_url, options) => { assert.equal(options.dispatcher, undefined); return calls++ ? new Response(html, { headers: { 'content-type': 'text/html' } }) : redirect('/en-us/search/'); },
  });
  assert.deepEqual(result, saved); assert.equal(result.total, 3);
  assert.equal(result.results[0].priceType, 'starting_at');
  assert.ok(logs.some((line) => line.startsWith('[URL_FINAL]')));
  assert.equal(calls, 2);
});

test('redireccion al desafio real se identifica y no se sigue', async () => {
  let calls = 0;
  await assert.rejects(createHttpAcquirer({ followDirectRedirects: true, fetchImpl: async () => {
    calls++; return redirect('https://www.backmarket.com/testchallengepage');
  } })({ query: 'iphone 13' }), { code: 'ACCESS_CHALLENGE' });
  assert.equal(calls, 1);
});

test('libera el cuerpo de una redireccion antes del siguiente GET', async () => {
  let cancelled = false; let calls = 0;
  const acquire = createHttpAcquirer({ followDirectRedirects: true, fetchImpl: async () => {
    if (calls++) { assert.equal(cancelled, true); return ok(); }
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 301, headers: { location: '/en-us/search/' } });
  } });
  await acquire({ query: 'x' });
  assert.equal(calls, 2);
});
