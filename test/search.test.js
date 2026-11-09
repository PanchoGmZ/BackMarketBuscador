import test from 'node:test';
import assert from 'node:assert/strict';
import { runSearch, validateInput } from '../src/search.js';

test('valida y normaliza input', () => {
  assert.deepEqual(validateInput({ query: '  iPad Air  ' }), { query: 'iPad Air', maxResults: 10, page: 1 });
  for (const input of [{}, { query: ' ' }, { query: 'x', page: 0 }, { query: 'x', maxResults: 51 }, { query: 'x', page: 1.5 }]) assert.throws(() => validateInput(input), { code: 'INVALID_INPUT' });
});
test('valida la opción de diagnóstico', () => {
  assert.doesNotThrow(() => validateInput({ query: 'x', diagnosticMode: true }));
  assert.throws(() => validateInput({ query: 'x', diagnosticMode: 'true' }), { code: 'INVALID_INPUT' });
});
test('la fuente pendiente falla sin escribir datos', async () => {
  let written = false;
  await assert.rejects(runSearch({ query: 'iPhone' }, { write: () => { written = true; } }), { code: 'SOURCE_UNAVAILABLE' });
  assert.equal(written, false);
});
test('fuente inyectada vacía escribe resultado vacío, no un error', async () => {
  let item;
  const result = await runSearch({ query: 'ninguno' }, { source: async () => ({ results: [], confirmedEmpty: true }), write: async (x) => { item = x; } });
  assert.deepEqual(result, { query: 'ninguno', total: 0, results: [] });
  assert.deepEqual(item, result);
});
test('errores de fuente y escritura se propagan', async () => {
  await assert.rejects(runSearch({ query: 'x' }, { source: async () => { throw new Error('conexión'); }, write: async () => {} }), /conexión/);
  await assert.rejects(runSearch({ query: 'x' }, { source: async () => ({ results: [], confirmedEmpty: true }), write: async () => { throw new Error('dataset'); } }), /dataset/);
  await assert.rejects(runSearch({ query: 'x' }, { source: async () => ({}), write: async () => {} }), { code: 'INVALID_SOURCE_RESPONSE' });
  await assert.rejects(runSearch({ query: 'x' }, { source: async () => ({ results: [] }), write: async () => {} }), { code: 'COMMERCIAL_DATA_NOT_FOUND' });
});
test('normaliza fichas inyectadas, conserva parámetros y elimina duplicados', async () => {
  const item = { title: ' Ejemplo ', url: '/en-us/p/ejemplo?l=12#vista' };
  let saved;
  const output = await runSearch({ query: 'x', maxResults: 2 }, { source: async () => ({ results: [item, item] }), write: async (x) => { saved = x; } });
  assert.equal(output.total, 1);
  assert.equal(output.results[0].url, 'https://www.backmarket.com/en-us/p/ejemplo?l=12');
  assert.equal(output.results[0].price, null);
  assert.equal(output.results[0].productId, null);
  assert.deepEqual(saved, output);
});
test('rechaza URL y precio inválidos', async () => {
  for (const item of [{ title: 'x', url: 'https://example.com/en-us/p/x' }, { title: 'x', url: '/en-us/p/x', price: '100' }]) {
    await assert.rejects(runSearch({ query: 'x' }, { source: async () => ({ results: [item] }), write: async () => {} }), { code: 'INVALID_SOURCE_RESPONSE' });
  }
});
