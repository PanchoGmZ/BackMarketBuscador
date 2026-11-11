import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalProxyAuth, hydrateLocalApifyToken } from '../src/local-auth.js';

test('el token guardado se pasa solo en memoria en ejecuciones locales', () => {
  const env = {};
  let reads = 0;
  assert.equal(hydrateLocalApifyToken({ env, readToken: () => { reads++; return 'test-token-value'; } }), true);
  assert.equal(env.APIFY_TOKEN, 'test-token-value');
  assert.equal(reads, 1);
});

test('no reemplaza un token de entorno ni consulta el keyring en Cloud', () => {
  const existing = { APIFY_TOKEN: 'provided' };
  assert.equal(hydrateLocalApifyToken({ env: existing, readToken: () => assert.fail('no debe leer') }), false);
  assert.equal(existing.APIFY_TOKEN, 'provided');
  const cloud = { APIFY_IS_AT_HOME: '1' };
  assert.equal(hydrateLocalApifyToken({ env: cloud, readToken: () => assert.fail('no debe leer') }), false);
});

test('proxy Apify local sin sesión da una instrucción clara; directo y Cloud no la exigen', () => {
  assert.throws(() => assertLocalProxyAuth({ proxyConfiguration: { useApifyProxy: true } }, {}), { code: 'APIFY_AUTH_REQUIRED' });
  assert.doesNotThrow(() => assertLocalProxyAuth({ proxyConfiguration: { useApifyProxy: false } }, {}));
  assert.doesNotThrow(() => assertLocalProxyAuth({ proxyConfiguration: { useApifyProxy: true } }, { APIFY_IS_AT_HOME: '1' }));
  assert.doesNotThrow(() => assertLocalProxyAuth({ proxyConfiguration: { useApifyProxy: true } }, { APIFY_PROXY_PASSWORD: 'provided' }));
});
