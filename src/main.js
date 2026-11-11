import { Actor, log } from 'apify';
import { executeSearch } from './runtime.js';
import { loadActorInput } from './input.js';
import { assertLocalProxyAuth } from './local-auth.js';
import { validateInput } from './search.js';

await Actor.init();
const started = Date.now();
try {
  const { input, source } = await loadActorInput({ actor: Actor });
  log.info(`[INPUT] Origen=${source}.`);
  validateInput(input);
  if (!process.env.BACKMARKET_FIXTURE) assertLocalProxyAuth(input);
  await executeSearch(input, { actor: Actor, log, fixture: process.env.BACKMARKET_FIXTURE });
  await Actor.exit();
} catch (error) {
  const message = `${error.code ?? 'ERROR'}: ${error.message}`;
  if (error.diagnostic) log.error(`[DIAGNOSTICO_CONEXION] ${JSON.stringify(error.diagnostic)}`);
  log.error(`[FIN] ${message}; tiempo: ${Date.now() - started} ms.`);
  await Actor.fail({ statusMessage: message });
}
