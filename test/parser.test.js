import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'cheerio';
import { parseSearchHtml } from '../src/parser.js';
import { runSearch } from '../src/search.js';

const html = await readFile(new URL('../fixtures/iphone.html', import.meta.url), 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
test('extrae las tarjetas reales del listado y excluye sugerencias', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const raw = parseSearchHtml(html, { query: 'iPhone 15 Pro' });
  assert.equal(raw.results.length, 31);
  const first = raw.results[0];
  assert.equal(first.title, 'iPhone 15 Pro • Unlocked');
  assert.equal(first.price, 480.20);
  assert.equal(first.currency, 'USD');
  assert.equal(first.productId, '245e5764-e159-4527-8c95-2388189fa473');
  assert.equal(first.category, 'Smartphones');
  assert.equal(first.condition, null);
  assert.match(first.url, /245e5764-e159-4527-8c95-2388189fa473\?l=12$/);
  assert.match(first.image, /^https:\/\//);
  assert.ok(!raw.results.some((p) => p.price === 537));
  const output = await runSearch({ query: 'iPhone 15 Pro', maxResults: 10 }, { source: async () => raw, write: async () => {} });
  assert.equal(output.total, 10);
  assert.match(output.results[0].url, /^https:\/\/www\.backmarket\.com\/en-us\/p\//);
});

test('no acepta una consulta distinta ni una página no verificada', { skip: !html && 'Falta fixtures/iphone.html' }, () => {
  assert.throws(() => parseSearchHtml(html, { query: 'MacBook' }), { code: 'QUERY_MISMATCH' });
  assert.throws(() => parseSearchHtml(html, { query: 'iPhone 15 Pro', page: 2 }), { code: 'PAGE_UNVERIFIED' });
  assert.throws(() => parseSearchHtml('<html><title>Denied</title></html>', { query: 'iPhone 15 Pro' }), { code: 'PARSING_ERROR' });
});

test('deduplica una tarjeta real repetida y tolera campos opcionales ausentes', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const $ = load(html);
  const first = $('[data-test="product-card"]').first();
  first.removeAttr('id').removeAttr('category');
  first.find('[data-test="product-card-image"]').remove();
  first.find('[data-qa="productCardPrice"]').remove();
  first.after(first.clone());
  const parsed = parseSearchHtml($.html(), { query: 'iPhone 15 Pro' });
  const output = await runSearch({ query: 'iPhone 15 Pro', maxResults: 50 }, { source: async () => parsed, write: async () => {} });
  assert.equal(parsed.results.length, 32);
  assert.equal(output.total, 31);
  for (const field of ['price', 'currency', 'image', 'productId', 'category', 'condition']) assert.equal(output.results[0][field], null);
});

test('el SDK escribe el Dataset local desde la captura real', { skip: !html && 'Falta fixtures/iphone.html' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bm-dataset-'));
  try {
    const inputDir = join(dir, 'key_value_stores', 'default');
    await mkdir(inputDir, { recursive: true });
    await writeFile(join(inputDir, 'INPUT.json'), JSON.stringify({ query: 'iPhone 15 Pro', maxResults: 2 }));
    const env = { ...process.env, CRAWLEE_STORAGE_DIR: dir, BACKMARKET_FIXTURE: 'iphone.html', APIFY_PURGE_ON_START: 'false' };
    delete env.APIFY_TOKEN;
    delete env.APIFY_IS_AT_HOME;
    const child = spawnSync(process.execPath, ['src/main.js'], { cwd: resolve('.'), env, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /\[ACTOR_INICIALIZACION\]/);
    assert.match(child.stdout, /\[ACTOR_DURACION\]/);
    const files = await readdir(join(dir, 'datasets', 'default'));
    const items = files.filter((name) => name.endsWith('.json'));
    assert.equal(items.length, 1);
    const record = JSON.parse(await readFile(join(dir, 'datasets', 'default', items[0]), 'utf8'));
    assert.equal(record.query, 'iPhone 15 Pro');
    assert.equal(record.total, 2);
    assert.equal(record.results[0].price, 480.2);
    assert.equal(record.results.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
