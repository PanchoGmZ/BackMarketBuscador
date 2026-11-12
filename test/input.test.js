import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadActorInput } from '../src/input.js';

const valid = { query: 'iphone 13' };

async function inTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'backmarket-input-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('input.json predeterminado valida y se carga localmente cuando falta el Input', async () => {
  const root = new URL('../input.json', import.meta.url);
  const parsed = JSON.parse((await readFile(root, 'utf8')).replace(/^\uFEFF/, ''));
  assert.deepEqual(parsed, valid);
  const result = await loadActorInput({ actor: { getInput: async () => undefined }, env: {} });
  assert.deepEqual(result, { input: valid, source: 'input.json' });
  assert.equal(JSON.stringify(parsed).match(/token|password|secret|credential/i), null);
});

test('cualquier Input explícito se respeta sin leer el archivo local', async () => {
  const explicit = { query: 'MacBook Pro', maxResults: 4 };
  await inTempDir(async (dir) => {
    const result = await loadActorInput({ actor: { getInput: async () => explicit }, env: { APIFY_INPUT_KEY: '__CLI_INPUT' }, inputPath: join(dir, 'does-not-exist.json') });
    assert.equal(result.input, explicit);
    assert.equal(result.source, 'apify');
  });
});

test('input.json local reemplaza el Input guardado que puede quedar obsoleto', async () => {
  const stale = { query: 'antigua b?squeda' };
  const result = await loadActorInput({ actor: { getInput: async () => stale }, env: { APIFY_INPUT_KEY: 'INPUT' } });
  assert.deepEqual(result, { input: valid, source: 'input.json' });
});

test('Cloud no consulta input.json aunque falte el Input de plataforma', async () => {
  await inTempDir(async (dir) => {
    const result = await loadActorInput({ actor: { getInput: async () => undefined }, env: { APIFY_IS_AT_HOME: '1' }, inputPath: join(dir, 'does-not-exist.json') });
    assert.deepEqual(result, { input: undefined, source: 'apify' });
  });
});

test('JSON inválido e Input local inválido producen errores claros', async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, 'input.json');
    await writeFile(path, '{broken', 'utf8');
    await assert.rejects(loadActorInput({ actor: { getInput: async () => null }, env: {}, inputPath: path }), { code: 'LOCAL_INPUT_ERROR' });
    await writeFile(path, JSON.stringify({ query: '' }), 'utf8');
    await assert.rejects(loadActorInput({ actor: { getInput: async () => null }, env: {}, inputPath: path }), { code: 'INVALID_INPUT' });
  });
});

test('input y esquemas Apify son JSON válidos', async () => {
  for (const file of ['../input.json', '../.actor/actor.json', '../.actor/input_schema.json', '../.actor/output_schema.json', '../.actor/dataset_schema.json']) {
    const text = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
    assert.doesNotThrow(() => JSON.parse(text), file);
  }
});
