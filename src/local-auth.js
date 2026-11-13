import { execSync } from 'node:child_process';
import { SearchError } from './search.js';
import { getOxylabsProxyConfig } from './oxylabs.js';

function getStoredApifyToken() {
  try {
    return execSync('apify auth token', {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 8 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function hydrateLocalApifyToken({ env = process.env, readToken = getStoredApifyToken } = {}) {
  if (env.APIFY_IS_AT_HOME === '1' || env.APIFY_IS_AT_HOME === 'true') return false;
  if (env.APIFY_TOKEN) return false;
  const token = readToken();
  if (!token) return false;
  env.APIFY_TOKEN = token;
  return true;
}

export function assertLocalProxyAuth(input, env = process.env) {
  if (env.APIFY_IS_AT_HOME === '1' || env.APIFY_IS_AT_HOME === 'true') return;
  if (getOxylabsProxyConfig(env)) return;
  const proxy = input?.proxyConfiguration;
  if (proxy?.useApifyProxy === false || proxy?.proxyUrls?.length) return;
  if (env.APIFY_TOKEN || env.APIFY_PROXY_PASSWORD) return;
  throw new SearchError('APIFY_AUTH_REQUIRED', 'El proxy UNBLOCKER requiere una sesión Apify local válida. Ejecuta `apify login` una vez y vuelve a iniciar con `apify run`.');
}
