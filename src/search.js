export class SearchError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'SearchError'; this.code = code; }
}

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SearchError('INVALID_INPUT', 'Se necesita un objeto de entrada.');
  if (typeof input.query !== 'string' || !input.query.trim() || input.query.trim().length > 200) throw new SearchError('INVALID_INPUT', 'query debe contener entre 1 y 200 caracteres.');
  const maxResults = input.maxResults ?? 10;
  const page = input.page ?? 1;
  for (const [name, value, limit] of [['maxResults', maxResults, 50], ['page', page, 100]]) {
    if (!Number.isInteger(value) || value < 1 || value > limit) throw new SearchError('INVALID_INPUT', `${name} debe ser un entero entre 1 y ${limit}.`);
  }
  if (input.proxyConfiguration != null && (typeof input.proxyConfiguration !== 'object' || Array.isArray(input.proxyConfiguration))) throw new SearchError('INVALID_INPUT', 'proxyConfiguration debe ser un objeto.');
  if (input.diagnosticMode != null && typeof input.diagnosticMode !== 'boolean') throw new SearchError('INVALID_INPUT', 'diagnosticMode debe ser booleano.');
  return { query: input.query.trim(), maxResults, page };
}

export function normalizeProduct(product) {
  if (!product || typeof product !== 'object' || typeof product.title !== 'string' || !product.title.trim()) throw new SearchError('INVALID_SOURCE_RESPONSE', 'Producto sin título válido.');
  let url;
  try { url = new URL(product.url, 'https://www.backmarket.com'); } catch { throw new SearchError('INVALID_SOURCE_RESPONSE', 'URL de producto inválida.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.backmarket.com' || !/^\/en-us\/p\/[^/]+/i.test(url.pathname) || url.username || url.password) throw new SearchError('INVALID_SOURCE_RESPONSE', 'URL de producto inválida.');
  url.hash = '';
  const optionalString = (key) => typeof product[key] === 'string' && product[key].trim() ? product[key].trim() : null;
  if (product.price != null && (typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0)) throw new SearchError('INVALID_SOURCE_RESPONSE', 'Precio de producto inválido.');
  return { title: product.title.trim(), price: product.price ?? null, currency: optionalString('currency'), url: url.href, image: optionalString('image'), productId: optionalString('productId'), category: optionalString('category'), condition: optionalString('condition'), priceType: optionalString('priceType') };
}

// This explicit boundary prevents a blocked or unverified endpoint being used by accident.
export async function unavailableSource() {
  throw new SearchError('SOURCE_UNAVAILABLE', 'No hay una fuente de búsqueda autorizada y verificada. No se realizó ninguna solicitud.');
}

export async function runSearch(input, { source = unavailableSource, write, onDeduplication = () => {} } = {}) {
  const params = validateInput(input);
  if (typeof write !== 'function') throw new TypeError('Se requiere una función de escritura.');
  const response = await source(params);
  if (!response || !Array.isArray(response.results)) throw new SearchError('INVALID_SOURCE_RESPONSE', 'La fuente no devolvió un listado válido.');
  if (!response.results.length && response.confirmedEmpty !== true) throw new SearchError('COMMERCIAL_DATA_NOT_FOUND', 'La fuente no confirmó que la búsqueda estuviera vacía.');
  const deduplicationStarted = performance.now();
  const seen = new Set();
  const results = [];
  for (const item of response.results) {
    const product = normalizeProduct(item);
    if (seen.has(product.url)) continue;
    seen.add(product.url);
    results.push(product);
    if (results.length >= params.maxResults) break;
  }
  onDeduplication({ elapsedMs: performance.now() - deduplicationStarted, candidates: response.results.length, results: results.length });
  const output = { query: params.query, total: results.length, results };
  await write(output);
  return output;
}
