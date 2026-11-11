import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SearchError, validateInput } from './search.js';

const DEFAULT_LOCAL_INPUT_PATH = fileURLToPath(new URL('../input.json', import.meta.url));

function isApifyCloud(env) {
  return env.APIFY_IS_AT_HOME === '1' || env.APIFY_IS_AT_HOME === 'true';
}

/** Prefer any platform/CLI input. Read the repository default only for a local run with no input. */
export async function loadActorInput({ actor, env = process.env, inputPath = DEFAULT_LOCAL_INPUT_PATH } = {}) {
  if (!actor || typeof actor.getInput !== 'function') throw new TypeError('Se requiere Actor.getInput().');
  const provided = await actor.getInput();
  if (isApifyCloud(env)) return { input: provided, source: 'apify' };
  const inputKey = env.APIFY_INPUT_KEY ?? env.ACTOR_INPUT_KEY;
  const cliDefaultStoreInput = inputKey === 'INPUT';
  if (provided !== undefined && provided !== null && !cliDefaultStoreInput) return { input: provided, source: 'apify' };

  let input;
  try {
    input = JSON.parse((await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw new SearchError('LOCAL_INPUT_ERROR', 'No se pudo leer input.json local como JSON válido.', { cause });
  }
  validateInput(input);
  return { input, source: 'input.json' };
}
