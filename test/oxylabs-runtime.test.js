import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeSearch } from '../src/runtime.js';

const html = await readFile(new URL('../fixtures/iphone.html', import.meta.url), 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
const logger = () => { const lines = []; return { lines, info: (line) => lines.push(line) }; };
const response = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const env = { OXYLABS_USERNAME: 'offline-user', OXYLABS_PASSWORD: 'local=p=a=ss', OXYLABS_HOST: 'unblock.oxylabs.io', OXYLABS_PORT: '60000' };

test('local Oxylabs usa ProxyAgent HTTPS, Basic y TLS acotada; cierra recursos', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const logs = logger();
  const agent = { closed: false, async close() { this.closed = true; } };
  let uri;
  let options;
  let calls = 0;
  let saved;
  const output = await executeSearch({ query: 'iPhone 15 Pro' }, {
    actor: { createProxyConfiguration: async () => assert.fail('Oxylabs no debe crear proxy de Apify'), pushData: async (value) => { saved = value; } },
    log: logs,
    env,
    makeProxyAgent: (value, agentOptions) => { uri = value; options = agentOptions; return agent; },
    fetchImpl: async (_url, requestOptions) => { calls++; assert.equal(requestOptions.dispatcher, agent); return response(html); },
  });
  assert.equal(uri, 'https://unblock.oxylabs.io:60000');
  assert.equal(options.token, 'Basic ' + Buffer.from('offline-user:local=p=a=ss').toString('base64'));
  assert.deepEqual(options.proxyTls, { rejectUnauthorized: true });
  assert.deepEqual(options.requestTls, { rejectUnauthorized: false });
  assert.equal(calls, 1);
  assert.equal(agent.closed, true);
  assert.deepEqual(output, saved);
  assert.equal(output.query, 'iPhone 15 Pro');
  assert.deepEqual(Object.keys(output).sort(), ['query', 'results', 'total']);
  assert.ok(logs.lines.some((line) => line.includes('[PROXY] Tipo=oxylabs')));
  assert.ok(logs.lines.includes('[TLS] {"proxyVerified":true,"targetVerified":false}'));
  assert.doesNotMatch(logs.lines.join('|'), /offline-user|local=p=a=ss|Basic /);
});

test('Cloud ignora credenciales Oxylabs y conserva UNBLOCKER y TLS actuales', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const logs = logger();
  let proxyConfiguration;
  let uri;
  let options;
  await executeSearch({ query: 'iPhone 15 Pro' }, {
    actor: {
      isAtHome: () => true,
      createProxyConfiguration: async (value) => { proxyConfiguration = value; return { newUrl: async () => 'http://proxy-user:proxy-password@apify.example:1234' }; },
      pushData: async () => {},
    },
    log: logs,
    env,
    makeProxyAgent: (value, agentOptions) => { uri = value; options = agentOptions; return { close: async () => {} }; },
    fetchImpl: async () => response(html),
  });
  assert.deepEqual(proxyConfiguration, { useApifyProxy: true, apifyProxyGroups: ['UNBLOCKER'] });
  assert.equal(uri, 'http://proxy-user:proxy-password@apify.example:1234');
  assert.deepEqual(options, { requestTls: { rejectUnauthorized: false } });
  assert.ok(logs.lines.includes('[TLS] {"verified":false}'));
  assert.doesNotMatch(logs.lines.join('|'), /offline-user|local=p=a=ss/);
});

test('local sin credenciales conserva conexion directa sin ProxyAgent', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const logs = logger();
  let creates = 0;
  let agents = 0;
  await executeSearch({ query: 'iPhone 15 Pro' }, {
    actor: { createProxyConfiguration: async () => { creates++; }, pushData: async () => {} },
    log: logs,
    env: {},
    makeProxyAgent: () => { agents++; throw new Error('unexpected proxy'); },
    fetchImpl: async () => response(html),
  });
  assert.equal(creates, 0);
  assert.equal(agents, 0);
  assert.ok(logs.lines.some((line) => line.startsWith('[PROXY] Con')));
});

test('credenciales Oxylabs parciales fallan sin fallback ni solicitud', async () => {
  let calls = 0;
  await assert.rejects(executeSearch({ query: 'iPhone 15 Pro' }, {
    actor: { createProxyConfiguration: async () => assert.fail('No debe cambiar de proxy'), pushData: async () => {} },
    log: logger(),
    env: { OXYLABS_USERNAME: 'private-user' },
    fetchImpl: async () => { calls++; return response(''); },
  }), { code: 'OXYLABS_CREDENTIALS_MISSING' });
  assert.equal(calls, 0);
});
