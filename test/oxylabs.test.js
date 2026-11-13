import test from 'node:test';
import assert from 'node:assert/strict';
import { ProxyAgent } from 'undici';
import { assertLocalProxyAuth } from '../src/local-auth.js';
import { getOxylabsProxyConfig } from '../src/oxylabs.js';

const credentials = { OXYLABS_USERNAME: 'wu_offline', OXYLABS_PASSWORD: 'p=a=ss', OXYLABS_HOST: 'unblock.oxylabs.io', OXYLABS_PORT: '60000' };

test('sin usuario ni password Oxylabs conserva la seleccion local existente', () => {
  assert.equal(getOxylabsProxyConfig({ OXYLABS_HOST: credentials.OXYLABS_HOST, OXYLABS_PORT: credentials.OXYLABS_PORT }), null);
});

test('codifica Basic sin poner credenciales en el URI y conserva signos igual', () => {
  const config = getOxylabsProxyConfig(credentials);
  assert.equal(config.uri, 'https://unblock.oxylabs.io:60000');
  assert.equal(config.token, 'Basic ' + Buffer.from('wu_offline:p=a=ss').toString('base64'));
  assert.equal(Buffer.from(config.token.slice('Basic '.length), 'base64').toString(), 'wu_offline:p=a=ss');
  assert.doesNotMatch(config.uri, /wu_offline|p=a=ss|@/);
});

test('credenciales parciales fallan claramente y no se convierten en modo directo', () => {
  assert.throws(() => getOxylabsProxyConfig({ OXYLABS_USERNAME: 'private-user' }), (error) => {
    assert.equal(error.code, 'OXYLABS_CREDENTIALS_MISSING');
    assert.doesNotMatch(error.message, /private-user/);
    return true;
  });
  assert.throws(() => assertLocalProxyAuth({ proxyConfiguration: { useApifyProxy: false } }, { OXYLABS_PASSWORD: 'private-password' }), { code: 'OXYLABS_CREDENTIALS_MISSING' });
});

test('host y puerto invalidos se rechazan sin incluir valores en el error', () => {
  assert.throws(() => getOxylabsProxyConfig({ ...credentials, OXYLABS_HOST: 'https://private.invalid/path' }), (error) => {
    assert.equal(error.code, 'OXYLABS_CONFIG_INVALID');
    assert.doesNotMatch(error.message, /private\.invalid/);
    return true;
  });
  assert.throws(() => getOxylabsProxyConfig({ ...credentials, OXYLABS_PORT: '70000' }), { code: 'OXYLABS_CONFIG_INVALID' });
});

test('Undici ProxyAgent 6 acepta HTTPS, token Basic y ajustes TLS sin abrir red', async () => {
  const config = getOxylabsProxyConfig(credentials);
  const agent = new ProxyAgent({
    uri: config.uri,
    token: config.token,
    proxyTls: { rejectUnauthorized: true },
    requestTls: { rejectUnauthorized: false },
  });
  await agent.close();
});
