import { SearchError } from './search.js';

const DEFAULT_HOST = 'unblock.oxylabs.io';
const DEFAULT_PORT = '60000';

export function getOxylabsProxyConfig(env = process.env) {
  const username = typeof env.OXYLABS_USERNAME === 'string' ? env.OXYLABS_USERNAME : '';
  const password = typeof env.OXYLABS_PASSWORD === 'string' ? env.OXYLABS_PASSWORD : '';
  const hasUsername = username.length > 0;
  const hasPassword = password.length > 0;
  if (!hasUsername && !hasPassword) return null;
  if (!hasUsername || !hasPassword) throw new SearchError('OXYLABS_CREDENTIALS_MISSING', 'Configura OXYLABS_USERNAME y OXYLABS_PASSWORD juntos en .env.local.');
  if (/[\r\n]/.test(username) || /[\r\n]/.test(password)) throw new SearchError('OXYLABS_CONFIG_INVALID', 'Las credenciales Oxylabs contienen caracteres no admitidos.');

  const host = env.OXYLABS_HOST || DEFAULT_HOST;
  const portValue = env.OXYLABS_PORT || DEFAULT_PORT;
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    throw new SearchError('OXYLABS_CONFIG_INVALID', 'OXYLABS_HOST debe ser un nombre de host valido, sin esquema ni ruta.');
  }
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SearchError('OXYLABS_CONFIG_INVALID', 'OXYLABS_PORT debe ser un puerto valido.');

  const token = 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64');
  return { uri: 'https://' + host + ':' + port, token };
}
