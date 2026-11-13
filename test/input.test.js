import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCAL_INPUT_PATH, LOCAL_INPUT_SOURCE, loadActorInput } from '../src/input.js';

const valid = { query: 'iphone 13' };
const source = 'storage/example/key_value_stores/default/INPUT.json';

async function inTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'backmarket-input-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('el Input local predeterminado apunta al INPUT.json elegido y no existe input.json en la raiz', async () => {
  const expected = fileURLToPath(new URL('../storage/example/key_value_stores/default/INPUT.json', import.meta.url));
  assert.equal(DEFAULT_LOCAL_INPUT_PATH, expected);
  assert.equal(LOCAL_INPUT_SOURCE, source);
  await assert.rejects(readFile(new URL('../input.json', import.meta.url)), { code: 'ENOENT' });
});

test('el INPUT.json versionado conserva unicamente el campo query', async () => {
  const parsed = JSON.parse((await readFile(DEFAULT_LOCAL_INPUT_PATH, 'utf8')).replace(/^\uFEFF/, ''));
  assert.deepEqual(Object.keys(parsed), ['query']);
  assert.equal(typeof parsed.query, 'string');
  assert.ok(parsed.query.length > 0);
});
test('el archivo local indicado valida y se usa cuando falta un Input explicito', async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, 'INPUT.json');
    await writeFile(path, JSON.stringify(valid), 'utf8');
    const result = await loadActorInput({ actor: { getInput: async () => undefined }, env: {}, inputPath: path });
    assert.deepEqual(result, { input: valid, source });
    assert.equal(JSON.stringify(result.input).match(/token|password|secret|credential/i), null);
  });
});

test('un Input explicito de CLI mantiene prioridad cuando se distingue', async () => {
  const explicit = { query: 'MacBook Pro', maxResults: 4 };
  await inTempDir(async (dir) => {
    const result = await loadActorInput({ actor: { getInput: async () => explicit }, env: { APIFY_INPUT_KEY: '__CLI_INPUT' }, inputPath: join(dir, 'does-not-exist.json') });
    assert.equal(result.input, explicit);
    assert.equal(result.source, 'apify');
  });
});

test('el Input local reemplaza un INPUT guardado que puede quedar obsoleto', async () => {
  const stale = { query: 'antigua busqueda' };
  await inTempDir(async (dir) => {
    const path = join(dir, 'INPUT.json');
    await writeFile(path, JSON.stringify(valid), 'utf8');
    const result = await loadActorInput({ actor: { getInput: async () => stale }, env: { APIFY_INPUT_KEY: 'INPUT' }, inputPath: path });
    assert.deepEqual(result, { input: valid, source });
  });
});

test('sin clave de Input de CLI el Input local prevalece sobre un valor implicito', async () => {
  const implicit = { query: 'valor anterior' };
  await inTempDir(async (dir) => {
    const path = join(dir, 'INPUT.json');
    await writeFile(path, JSON.stringify(valid), 'utf8');
    const result = await loadActorInput({ actor: { getInput: async () => implicit }, env: {}, inputPath: path });
    assert.deepEqual(result, { input: valid, source });
  });
});

test('Cloud usa unicamente el Input oficial sin intentar leer el archivo local', async () => {
  await inTempDir(async (dir) => {
    const cloudInput = { query: 'Cloud input' };
    const result = await loadActorInput({ actor: { getInput: async () => cloudInput }, env: { APIFY_IS_AT_HOME: '1' }, inputPath: join(dir, 'does-not-exist.json') });
    assert.deepEqual(result, { input: cloudInput, source: 'apify' });
  });
});

test('JSON local invalido e Input local invalido producen errores claros', async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, 'INPUT.json');
    await writeFile(path, '{broken', 'utf8');
    await assert.rejects(loadActorInput({ actor: { getInput: async () => null }, env: {}, inputPath: path }), { code: 'LOCAL_INPUT_ERROR' });
    await writeFile(path, JSON.stringify({ query: '' }), 'utf8');
    await assert.rejects(loadActorInput({ actor: { getInput: async () => null }, env: {}, inputPath: path }), { code: 'INVALID_INPUT' });
  });
});

test('los esquemas Apify siguen siendo JSON valido', async () => {
  for (const file of ['../.actor/actor.json', '../.actor/input_schema.json', '../.actor/output_schema.json', '../.actor/dataset_schema.json']) {
    const text = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
    assert.doesNotThrow(() => JSON.parse(text), file);
  }
});
