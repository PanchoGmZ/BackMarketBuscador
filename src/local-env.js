import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCAL_ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

function isApifyCloud(env) {
  return env.APIFY_IS_AT_HOME === '1' || env.APIFY_IS_AT_HOME === 'true';
}

export function loadLocalEnvironment({ env = process.env, path = LOCAL_ENV_PATH, exists = existsSync, loadEnvFile } = {}) {
  if (isApifyCloud(env)) return false;
  if (!exists(path)) return false;

  const loader = loadEnvFile ?? process.loadEnvFile;
  if (typeof loader !== 'function') throw new Error('Se requiere process.loadEnvFile; ejecuta el proyecto local con Node.js 24.');
  try {
    loader.call(process, path);
    return true;
  } catch {
    throw new Error('No se pudo cargar .env.local; revisa su formato y permisos.');
  }
}
