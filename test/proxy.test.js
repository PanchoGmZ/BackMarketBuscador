import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { fetch, ProxyAgent } from 'undici';
import { createHttpAcquirer } from '../src/acquisition.js';
import { classifyConnectionError } from '../src/diagnostics.js';

const listen = async (server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test('Undici envía CONNECT y autenticación al proxy local y cierra el agente', async () => {
  const target = http.createServer((_req, res) => res.end('respuesta local'));
  const targetPort = await listen(target);
  let auth; let method; let connectPath;
  const proxy = http.createServer();
  proxy.on('connect', (req, socket, head) => {
    auth = req.headers['proxy-authorization']; method = req.method; connectPath = req.url;
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
  });
  const proxyPort = await listen(proxy);
  const agent = new ProxyAgent(`http://testuser:testpass@127.0.0.1:${proxyPort}`);
  try {
    const res = await fetch(`http://127.0.0.1:${targetPort}/`, { dispatcher: agent, signal: AbortSignal.timeout(3000) });
    assert.equal(await res.text(), 'respuesta local');
    assert.equal(method, 'CONNECT');
    assert.equal(connectPath, `127.0.0.1:${targetPort}`);
    assert.equal(auth, `Basic ${Buffer.from('testuser:testpass').toString('base64')}`);
  } finally { await agent.close(); await close(proxy); await close(target); }
});

test('un proxy local 407 se identifica como error de autenticación CONNECT', async () => {
  const proxy = http.createServer();
  proxy.on('connect', (_req, socket) => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'));
  const port = await listen(proxy);
  const agent = new ProxyAgent(`http://user:pass@127.0.0.1:${port}`);
  try {
    const acquire = createHttpAcquirer({ proxy: true, fetchImpl: (url, options) => fetch(url, { ...options, dispatcher: agent }), timeoutMs: 3000 });
    await assert.rejects(acquire({ query: 'x' }), (error) => {
      assert.equal(error.code, 'PROXY_AUTH_ERROR');
      assert.equal(error.diagnostic.connectStatus, 407);
      assert.ok(error.cause);
      return true;
    });
  } finally { await agent.close(); await close(proxy); }
});

test('clasifica errores anidados sin exponer mensajes ni secretos', () => {
  for (const [nestedCode, expected] of [['ENOTFOUND', 'DNS_ERROR'], ['ECONNREFUSED', 'TCP_ERROR'], ['CERT_HAS_EXPIRED', 'TLS_ERROR'], ['UND_ERR_CONNECT_TIMEOUT', 'TIMEOUT'], ['UND_ERR_SOCKET', 'TCP_ERROR']]) {
    const error = new Error('password=secret', { cause: Object.assign(new Error('token secret'), { code: nestedCode }) });
    const result = classifyConnectionError(error, { proxy: true, elapsedMs: 25 });
    assert.equal(result.code, expected);
    assert.deepEqual(result.diagnostic.codes, [nestedCode]);
    assert.doesNotMatch(JSON.stringify(result), /secret|password|token/);
  }
  const unknown = new Error('https://user:password@example.test');
  unknown.code = 'user:password';
  assert.doesNotMatch(JSON.stringify(classifyConnectionError(unknown)), /password/);
});
