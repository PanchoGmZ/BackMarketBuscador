import { Actor, log } from 'apify';
import { runSearch } from './search.js';
import { acquireFixture } from './acquisition.js';
import { parseSearchHtml } from './parser.js';

await Actor.init();
const started = Date.now();
try {
  const input = await Actor.getInput();
  const fixture = process.env.BACKMARKET_FIXTURE;
  let source;
  log.info('[INICIO] Búsqueda iniciada.');
  log.info('[PROXY] Sin proxy; adquisición live deshabilitada.');
  if (fixture) {
    source = async (params) => {
      const acquisitionStart = Date.now();
      const html = await acquireFixture(fixture);
      log.info(`[HTML_LISTO] Captura local leída en ${Date.now() - acquisitionStart} ms.`);
      const parseStart = Date.now();
      const parsed = parseSearchHtml(html, params);
      if (input?.diagnosticMode) log.info(`[DIAGNOSTICO] Parsing: ${Date.now() - parseStart} ms.`);
      return parsed;
    };
    log.info('Modo fixture: usando una captura local; los datos no son necesariamente actuales.');
  } else {
    log.info('Modo live: adquisición deshabilitada por restricciones de acceso pendientes de resolver.');
  }
  const output = await runSearch(input, { source, write: async (data) => {
    log.info(`[PRODUCTOS_ENCONTRADOS] ${data.total}`);
    const writeStart = Date.now();
    await Actor.pushData(data);
    log.info(`[GUARDADO] Dataset escrito en ${Date.now() - writeStart} ms.`);
  } });
  log.info(`[FIN] Resultados: ${output.total}; tiempo: ${Date.now() - started} ms`);
  await Actor.exit();
} catch (error) {
  log.error(`${error.code ?? 'ERROR'}: ${error.message}; tiempo: ${Date.now() - started} ms`);
  await Actor.fail({ statusMessage: `${error.code ?? 'ERROR'}: ${error.message}` });
}
