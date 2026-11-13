import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SearchError, validateInput } from './search.js';

export const DEFAULT_LOCAL_INPUT_PATH = fileURLToPath(new URL('../storage/example/key_value_stores/default/INPUT.json', import.meta.url));
export const LOCAL_INPUT_SOURCE = 'storage/example/key_value_stores/default/INPUT.json';

function isApifyCloud(env) {
  return env.APIFY_IS_AT_HOME === '1' || env.APIFY_IS_AT_HOME === 'true';
}

// Production always uses the owner's UNBLOCKER; local runs default to direct.
export function effectiveProxyConfiguration(input, atHome) {
  if (atHome) return { useApifyProxy: true, apifyProxyGroups: ['UNBLOCKER'] };
  return input?.proxyConfiguration ?? { useApifyProxy: false };
}

/** Prefer any platform/CLI input. Read the repository default only for a local run with no input. */
export async function loadActorInput({ actor, env = process.env, inputPath = DEFAULT_LOCAL_INPUT_PATH } = {}) {
  if (!actor || typeof actor.getInput !== 'function') throw new TypeError('Se requiere Actor.getInput().');
  const provided = await actor.getInput();
  if (isApifyCloud(env)) return { input: provided, source: 'apify' };
  const inputKey = env.APIFY_INPUT_KEY ?? env.ACTOR_INPUT_KEY;
  const explicitCliInput = inputKey !== undefined && inputKey !== 'INPUT';
  if (provided !== undefined && provided !== null && explicitCliInput) return { input: provided, source: 'apify' };

  let input;
  try {
    input = JSON.parse((await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw new SearchError('LOCAL_INPUT_ERROR', 'No se pudo leer storage/example/key_value_stores/default/INPUT.json como JSON valido.', { cause });
  }
  validateInput(input);
  return { input, source: LOCAL_INPUT_SOURCE };
}
