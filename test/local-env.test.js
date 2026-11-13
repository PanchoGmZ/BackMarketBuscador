import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnvironment } from '../src/local-env.js';

test('Cloud no comprueba ni carga .env.local', () => {
  let checked = false;
  let loaded = false;
  const result = loadLocalEnvironment({
    env: { APIFY_IS_AT_HOME: '1' },
    path: 'unused.env',
    exists: () => { checked = true; return true; },
    loadEnvFile: () => { loaded = true; },
  });
  assert.equal(result, false);
  assert.equal(checked, false);
  assert.equal(loaded, false);
});

test('sin .env.local la configuracion local es opcional', () => {
  assert.equal(loadLocalEnvironment({ env: {}, path: 'not-present.env', exists: () => false }), false);
});

test('Node carga localmente .env.local nativo y conserva valores con signo igual', async () => {
  assert.equal(typeof process.loadEnvFile, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'backmarket-env-'));
  const key = 'BACKMARKET_LOCAL_ENV_TEST_' + process.pid;
  const previous = process.env[key];
  try {
    const file = join(dir, '.env.local');
    await writeFile(file, key + '=left=middle=right\n', 'utf8');
    delete process.env[key];
    assert.equal(loadLocalEnvironment({ env: {}, path: file }), true);
    assert.equal(process.env[key], 'left=middle=right');
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('errores de lectura no incluyen contenido sensible', () => {
  assert.throws(() => loadLocalEnvironment({ env: {}, path: 'present.env', exists: () => true, loadEnvFile: () => { throw new Error('private-password=hidden'); } }), (error) => {
    assert.match(error.message, /No se pudo cargar \.env\.local/);
    assert.doesNotMatch(error.message, /private-password|hidden/);
    return true;
  });
});
