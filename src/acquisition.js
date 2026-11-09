import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SearchError } from './search.js';

const SEARCH_URL = 'https://www.backmarket.com/en-us/search';
const MAX_BYTES = 4 * 1024 * 1024;

export function buildSearchUrl(query) {
  if (typeof query !== 'string' || !query.trim()) throw new SearchError('INVALID_INPUT', 'La búsqueda es obligatoria.');
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query.trim());
  return url.href;
}

export async function acquireFixture(filename) {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9_.-]+\.html?$/i.test(filename) || filename.startsWith('.')) throw new SearchError('INVALID_FIXTURE', 'Nombre de fixture inválido.');
  try { return await readFile(resolve('fixtures', filename), 'utf8'); }
  catch (error) { throw new SearchError('FIXTURE_ERROR', 'No se pudo leer la captura local.', { cause: error }); }
}

// Una sola solicitud; no se siguen redirecciones ni se reintentan bloqueos.
export function createHttpAcquirer({ fetchImpl, timeoutMs = 15000, onHttp = () => {} } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Se requiere un transporte HTTP explícito.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('Timeout inválido.');
  return async ({ query, page = 1 }) => {
    if (page !== 1) throw new SearchError('PAGE_UNVERIFIED', 'La paginación HTTP todavía no está verificada.');
    const url = buildSearchUrl(query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'manual', headers: { accept: 'text/html' } });
      onHttp(response.status);
      let httpError;
      if (response.status === 403 || response.status === 401) httpError = new SearchError('ACCESS_DENIED', `Acceso denegado: HTTP ${response.status}.`);
      else if (response.status === 429) httpError = new SearchError('RATE_LIMITED', 'Back Market respondió HTTP 429.');
      else if (response.status >= 300 && response.status < 400) httpError = new SearchError('UNEXPECTED_REDIRECT', `Redirección HTTP ${response.status}; no se sigue automáticamente.`);
      else if (!response.ok) httpError = new SearchError('HTTP_ERROR', `Error HTTP ${response.status}.`);
      if (httpError) { await response.body?.cancel().catch(() => {}); throw httpError; }
      const contentType = response.headers.get('content-type') || '';
      if (!/^text\/html(?:\s*;|\s*$)/i.test(contentType)) { await response.body?.cancel().catch(() => {}); throw new SearchError('INVALID_CONTENT_TYPE', 'La respuesta no es HTML.'); }
      const advertised = Number(response.headers.get('content-length'));
      if (advertised > MAX_BYTES) { await response.body?.cancel().catch(() => {}); throw new SearchError('RESPONSE_TOO_LARGE', 'La respuesta supera el tamaño permitido.'); }
      if (!response.body) throw new SearchError('EMPTY_RESPONSE', 'La respuesta no contiene HTML.');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) { controller.abort(); throw new SearchError('RESPONSE_TOO_LARGE', 'La respuesta supera el tamaño permitido.'); }
        chunks.push(chunk);
      }
      const html = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
      if (!html.trim()) throw new SearchError('EMPTY_RESPONSE', 'La respuesta no contiene HTML.');
      if (/<title[^>]*>\s*(?:just a moment|attention required|access denied|security verification)/i.test(html) || /(?:id|class)=["'][^"']*(?:cf-challenge|g-recaptcha|h-captcha|cf-turnstile)[^"']*["']/i.test(html)) throw new SearchError('ACCESS_CHALLENGE', 'La respuesta contiene un desafío de acceso.');
      return html;
    } catch (error) {
      if (error instanceof SearchError) throw error;
      if (controller.signal.aborted) throw new SearchError('TIMEOUT', 'La solicitud HTTP agotó el plazo.', { cause: error });
      throw new SearchError('NETWORK_ERROR', 'No se pudo obtener el HTML de búsqueda.', { cause: error });
    } finally { clearTimeout(timer); }
  };
}
