import { fetch as httpFetch, ProxyAgent } from 'undici';
import { acquireFixture, createHttpAcquirer } from './acquisition.js';
import { parseSearchHtml } from './parser.js';
import { runSearch, validateInput, SearchError } from './search.js';

export async function executeSearch(input, { actor, log, fixture, fetchImpl = httpFetch, makeProxyAgent = (url) => new ProxyAgent(url) }) {
  const started = Date.now();
  const params = validateInput(input);
  let dispatcher;
  log.info('[INICIO] Búsqueda iniciada.');
  try {
    let acquire;
    if (fixture) {
      if (process.env.APIFY_IS_AT_HOME === '1' || process.env.APIFY_IS_AT_HOME === 'true') throw new SearchError('INVALID_MODE', 'El modo fixture está disponible solo localmente.');
      log.info('[PROXY] No se utiliza proxy en modo fixture.');
      log.info('[NAVEGACION] Modo fixture: captura local, no son datos actuales.');
      acquire = () => acquireFixture(fixture);
    } else {
      if (input.proxyConfiguration) {
        let proxy;
        try { proxy = await actor.createProxyConfiguration(input.proxyConfiguration); }
        catch { throw new SearchError('PROXY_ERROR', 'No se pudo configurar el proxy de Apify.'); }
        if (proxy) {
          let url;
          try { url = await proxy.newUrl(); dispatcher = makeProxyAgent(url); }
          catch { throw new SearchError('PROXY_ERROR', 'No se pudo inicializar el proxy.'); }
          log.info('[PROXY] Configuración de proxy activada.');
        } else log.info('[PROXY] Conexión directa.');
      } else log.info('[PROXY] Conexión directa.');
      log.info('[NAVEGACION] Solicitud HTTP de búsqueda live, sin reintentos.');
      const fetchWithProxy = dispatcher ? (url, options) => fetchImpl(url, { ...options, dispatcher }) : fetchImpl;
      acquire = createHttpAcquirer({ fetchImpl: fetchWithProxy, onHttp: (status) => log.info(`[HTTP] ${status}`) });
    }
    const output = await runSearch(input, { source: async () => {
      const start = Date.now();
      const html = await acquire(params);
      log.info(`[HTML_LISTO] Adquisición: ${Date.now() - start} ms.`);
      const parseStart = Date.now();
      const parsed = parseSearchHtml(html, params);
      if (input.diagnosticMode) log.info(`[DIAGNOSTICO] Parsing: ${Date.now() - parseStart} ms.`);
      return parsed;
    }, write: async (data) => {
      log.info(`[PRODUCTOS_ENCONTRADOS] ${data.total}`);
      const start = Date.now();
      await actor.pushData(data);
      log.info(`[GUARDADO] Dataset escrito en ${Date.now() - start} ms.`);
    } });
    log.info(`[FIN] Resultados: ${output.total}; tiempo: ${Date.now() - started} ms.`);
    return output;
  } finally {
    if (dispatcher) await dispatcher.close();
  }
}
