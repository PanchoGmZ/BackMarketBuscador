import { fetch as httpFetch, ProxyAgent } from 'undici';
import { acquireFixture, createHttpAcquirer } from './acquisition.js';
import { parseSearchHtml } from './parser.js';
import { runSearch, validateInput, SearchError } from './search.js';
import { classifyConnectionError } from './diagnostics.js';
import { buildSearchUrl } from './acquisition.js';

function proxyError(message, cause, stage) {
  const error = new SearchError('PROXY_ERROR', message, { cause });
  error.diagnostic = classifyConnectionError(cause, { proxy: true, stage }).diagnostic;
  return error;
}

export async function executeSearch(input, { actor, log, fixture, fetchImpl = httpFetch, makeProxyAgent = (url, options) => new ProxyAgent({ uri: url, ...options }) }) {
  const started = Date.now();
  const params = validateInput(input);
  let dispatcher;
  let failure;
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
        catch (error) { throw proxyError('No se pudo configurar el proxy de Apify.', error, 'proxy_configuration'); }
        if (proxy) {
          let url;
          try {
            url = await proxy.newUrl();
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported proxy protocol');
            if (Boolean(parsed.username) !== Boolean(parsed.password)) throw new Error('Incomplete proxy credentials');
            dispatcher = makeProxyAgent(url, { requestTls: { rejectUnauthorized: false } });
            const type = input.proxyConfiguration.useApifyProxy ? 'apify' : 'personalizado';
            log.info(`[PROXY] Tipo=${type}; protocolo=${parsed.protocol.slice(0, -1)}; credenciales=${Boolean(parsed.username && parsed.password) ? 'presentes' : 'ausentes'}.`);
            log.info('[TLS] {"verified":false}');
          } catch (error) { throw proxyError('No se pudo inicializar el proxy.', error, 'proxy_initialization'); }
        } else {
          if (input.proxyConfiguration.useApifyProxy === true || input.proxyConfiguration.proxyUrls?.length) throw proxyError('El SDK no devolvió el proxy solicitado.', new Error('Proxy configuration missing'), 'proxy_configuration');
          log.info('[PROXY] Conexión directa.');
        }
      } else log.info('[PROXY] Conexión directa.');
      const effectiveUrl = new URL(buildSearchUrl(params.query));
      effectiveUrl.searchParams.set('q', '[REDACTED]');
      log.info(`[URL] ${effectiveUrl.href}`);
      log.info('[NAVEGACION] Solicitud HTTP de búsqueda live, sin reintentos.');
      const fetchWithProxy = dispatcher ? (url, options) => fetchImpl(url, { ...options, dispatcher }) : fetchImpl;
      acquire = createHttpAcquirer({ fetchImpl: fetchWithProxy, proxy: Boolean(dispatcher), onHttp: (status) => log.info(`[HTTP] ${status}`) });
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
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (dispatcher) {
      try { await dispatcher.close(); }
      catch (error) {
        if (!failure) throw proxyError('No se pudo cerrar el proxy.', error, 'proxy_close');
        log.warning?.('[PROXY] Error al cerrar recursos después del fallo principal.');
      }
    }
  }
}
