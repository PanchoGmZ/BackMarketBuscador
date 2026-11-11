import { Actor, log } from 'apify';
import { executeSearch } from './runtime.js';
import { loadActorInput } from './input.js';
import { assertLocalProxyAuth } from './local-auth.js';
import { validateInput } from './search.js';

process.once('exit', (code) => {
  log.info(`[ACTOR_DURACION] ${JSON.stringify({ processElapsedMs: performance.now(), exitCode: code })}`);
});

const initStarted = performance.now();
await Actor.init();
const initializationMs = performance.now() - initStarted;
const started = performance.now();
log.info(`[ACTOR_INICIALIZACION] ${JSON.stringify({ initializationMs, processElapsedMs: performance.now() })}`);
try {
  const { input, source } = await loadActorInput({ actor: Actor });
  log.info(`[INPUT] Origen=${source}.`);
  validateInput(input);
  if (!process.env.BACKMARKET_FIXTURE) assertLocalProxyAuth(input);
  await executeSearch(input, { actor: Actor, log, fixture: process.env.BACKMARKET_FIXTURE });
  log.info(`[ACTOR_SALIDA] ${JSON.stringify({ processElapsedBeforeExitMs: performance.now() })}`);
  await Actor.exit();
} catch (error) {
  const message = `${error.code ?? 'ERROR'}: ${error.message}`;
  if (error.diagnostic) log.error(`[DIAGNOSTICO_CONEXION] ${JSON.stringify(error.diagnostic)}`);
  log.error(`[FIN] ${message}; tiempo: ${performance.now() - started} ms.`);
  log.info(`[ACTOR_SALIDA] ${JSON.stringify({ processElapsedBeforeExitMs: performance.now() })}`);
  await Actor.fail({ statusMessage: message });
}
