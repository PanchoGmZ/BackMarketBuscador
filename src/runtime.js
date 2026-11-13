import { fetch as httpFetch, ProxyAgent } from 'undici';
import { acquireFixture, buildSearchUrl, createHttpAcquirer, resolveHttpTimeoutMs } from './acquisition.js';
import { parseSearchHtml } from './parser.js';
import { runSearch, validateInput, SearchError } from './search.js';
import { classifyConnectionError } from './diagnostics.js';
import { effectiveProxyConfiguration } from './input.js';
import { getOxylabsProxyConfig } from './oxylabs.js';

function proxyError(message, cause, stage) {
  const error = new SearchError('PROXY_ERROR', message, { cause });
  error.diagnostic = classifyConnectionError(cause, { proxy: true, stage }).diagnostic;
  return error;
}

export async function executeSearch(input, { actor, log, fixture, fetchImpl = httpFetch, makeProxyAgent = (url, options) => new ProxyAgent({ uri: url, ...options }), env = process.env }) {
  const started = performance.now();
  const metrics = { proxySetupMs: null, acquisitionMs: null, parsingMs: null, cardsParsed: null, deduplicationMs: null, datasetMs: null, dispatcherCloseMs: null };
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
      const proxyStarted = performance.now();
      const atHome = typeof actor.isAtHome === 'function' ? actor.isAtHome() : env.APIFY_IS_AT_HOME === '1' || env.APIFY_IS_AT_HOME === 'true';
      let direct = false;
      const oxylabsProxy = atHome ? null : getOxylabsProxyConfig(env);
      if (oxylabsProxy) {
        try {
          dispatcher = makeProxyAgent(oxylabsProxy.uri, {
            token: oxylabsProxy.token,
            proxyTls: { rejectUnauthorized: true },
            requestTls: { rejectUnauthorized: false },
          });
        } catch (error) { throw proxyError('No se pudo inicializar Oxylabs Web Unblocker.', error, 'proxy_initialization'); }
        log.info('[PROXY] Tipo=oxylabs; protocolo=https; credenciales=presentes.');
        log.info('[TLS] {"proxyVerified":true,"targetVerified":false}');
      } else {
        const proxyConfiguration = effectiveProxyConfiguration(input, atHome);
        direct = proxyConfiguration.useApifyProxy === false && !proxyConfiguration.proxyUrls?.length;
        if (!direct) {
          let proxy;
          try { proxy = await actor.createProxyConfiguration(proxyConfiguration); }
          catch (error) { throw proxyError('No se pudo configurar el proxy de Apify.', error, 'proxy_configuration'); }
          if (proxy) {
            let url;
            try {
              url = await proxy.newUrl();
              const parsed = new URL(url);
              if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported proxy protocol');
              if (Boolean(parsed.username) !== Boolean(parsed.password)) throw new Error('Incomplete proxy credentials');
              dispatcher = makeProxyAgent(url, { requestTls: { rejectUnauthorized: false } });
              const type = proxyConfiguration.useApifyProxy ? 'apify' : 'personalizado';
              const groups = proxyConfiguration.apifyProxyGroups;
              const safeGroups = Array.isArray(groups) ? groups.filter((group) => typeof group === 'string' && /^[A-Z0-9_-]{1,40}$/.test(group)) : [];
              log.info(`[PROXY] Tipo=${type}; protocolo=${parsed.protocol.slice(0, -1)}; grupos=${safeGroups.length ? safeGroups.join(',') : 'automático'}; credenciales=${Boolean(parsed.username && parsed.password) ? 'presentes' : 'ausentes'}.`);
              log.info('[TLS] {"verified":false}');
            } catch (error) { throw proxyError('No se pudo inicializar el proxy.', error, 'proxy_initialization'); }
          } else {
            if (proxyConfiguration.useApifyProxy === true || proxyConfiguration.proxyUrls?.length) throw proxyError('El SDK no devolvió el proxy solicitado.', new Error('Proxy configuration missing'), 'proxy_configuration');
            log.info('[PROXY] Conexión directa.');
          }
        } else log.info('[PROXY] Conexión directa.');
      }
      metrics.proxySetupMs = performance.now() - proxyStarted;
      const effectiveUrl = new URL(buildSearchUrl(params.query));
      effectiveUrl.searchParams.set('q', '[REDACTED]');
      log.info(`[URL] ${effectiveUrl.href}`);
      const httpTimeoutMs = resolveHttpTimeoutMs(Boolean(input.diagnosticMode), env);
      const totalBudgetMs = httpTimeoutMs + 30_000;
      log.info(`[LIMITES] ${JSON.stringify({ httpTimeoutMs, totalBudgetMs, parsingDatasetCloseMarginMs: 30_000, totalBudgetEnforcedBy: 'Apify run timeout must be >= totalBudgetMs' })}`);
      log.info('[NAVEGACION] Solicitud HTTP de búsqueda live, sin reintentos.');
      const fetchWithProxy = dispatcher ? (url, options) => fetchImpl(url, { ...options, dispatcher }) : fetchImpl;
      acquire = createHttpAcquirer({ fetchImpl: fetchWithProxy, timeoutMs: httpTimeoutMs, proxy: Boolean(dispatcher), followDirectRedirects: direct, onFinalUrl: (url) => log.info(`[URL_FINAL] ${url}`), onHttp: (status, url) => log.info(`[HTTP] ${status} ${url}`), onTiming: (timing) => log.info(`[TIEMPO_HTTP] ${JSON.stringify(timing)}`) });
    }
    const output = await runSearch(input, { source: async () => {
      const start = performance.now();
      let html;
      try { html = await acquire(params); } finally { metrics.acquisitionMs = performance.now() - start; }
      log.info(`[HTML_LISTO] Adquisición: ${performance.now() - start} ms.`);
      const parseStart = performance.now();
      let parsed;
      try { parsed = parseSearchHtml(html, params); } finally { metrics.parsingMs = performance.now() - parseStart; }
      metrics.cardsParsed = parsed.results.length;
      if (input.diagnosticMode) log.info(`[DIAGNOSTICO] Parsing: ${metrics.parsingMs} ms.`);
      return parsed;
    }, onDeduplication: ({ elapsedMs }) => { metrics.deduplicationMs = elapsedMs; }, write: async (data) => {
      log.info(`[PRODUCTOS_ENCONTRADOS] ${data.total}`);
      const start = performance.now();
      try { await actor.pushData(data); } finally { metrics.datasetMs = performance.now() - start; }
      log.info(`[GUARDADO] Dataset escrito en ${performance.now() - start} ms.`);
    } });
    log.info(`[FIN] Resultados: ${output.total}; tiempo: ${performance.now() - started} ms.`);
    return output;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (dispatcher) {
        const closeStarted = performance.now();
        try { await dispatcher.close(); }
        catch (error) {
          if (!failure) throw proxyError('No se pudo cerrar el proxy.', error, 'proxy_close');
          log.warning?.('[PROXY] Error al cerrar recursos después del fallo principal.');
        } finally { metrics.dispatcherCloseMs = performance.now() - closeStarted; }
      }
    } finally {
      log.info(`[RENDIMIENTO] ${JSON.stringify({ ...metrics, runtimeMs: performance.now() - started })}`);
    }
  }
}
