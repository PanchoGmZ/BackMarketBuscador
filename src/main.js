import { Actor, log } from 'apify';
import { executeSearch } from './runtime.js';

await Actor.init();
const started = Date.now();
try {
  const input = await Actor.getInput();
  await executeSearch(input, { actor: Actor, log, fixture: process.env.BACKMARKET_FIXTURE });
  await Actor.exit();
} catch (error) {
  const message = `${error.code ?? 'ERROR'}: ${error.message}`;
  log.error(`[FIN] ${message}; tiempo: ${Date.now() - started} ms.`);
  await Actor.fail({ statusMessage: message });
}
