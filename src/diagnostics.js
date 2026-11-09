// Se registran únicamente códigos conocidos y valores derivados; nunca mensajes,
// direcciones, credenciales, cabeceras ni objetos de error completos.
const allowedCodes = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'UND_ERR_ABORTED', 'UND_ERR_PRX_TLS', 'UND_ERR_INVALID_ARG', 'UND_ERR_CLOSED', 'UND_ERR_DESTROYED',
]);

export function classifyConnectionError(error, { proxy = false, stage = 'request', elapsedMs = 0, aborted = false } = {}) {
  const queue = [error]; const seen = new Set(); const codes = []; let connectStatus = null;
  while (queue.length && seen.size < 20) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (allowedCodes.has(current.code) && !codes.includes(current.code)) codes.push(current.code);
    // Undici 6 reports failed CONNECT status inside its own RequestAbortedError.
    if (current.code === 'UND_ERR_ABORTED' && typeof current.message === 'string') {
      const match = /^Proxy response \((\d{3})\) !== 200 when HTTP Tunneling$/.exec(current.message);
      if (match) connectStatus = Number(match[1]);
    }
    if (current.cause) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  let code = 'NETWORK_ERROR';
  if (connectStatus !== null) code = connectStatus === 407 ? 'PROXY_AUTH_ERROR' : 'PROXY_CONNECT_ERROR';
  else if (codes.some((c) => /CERT|UND_ERR_PRX_TLS/.test(c))) code = 'TLS_ERROR';
  else if (aborted || codes.some((c) => /TIMEOUT|ETIMEDOUT/.test(c))) code = 'TIMEOUT';
  else if (codes.some((c) => c === 'ENOTFOUND' || c === 'EAI_AGAIN')) code = 'DNS_ERROR';
  else if (codes.some((c) => ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET'].includes(c))) code = 'TCP_ERROR';
  else if (codes.some((c) => c.startsWith('UND_ERR_'))) code = 'UNDICI_ERROR';
  const diagnostic = { stage, proxy, elapsedMs, codes, ...(connectStatus !== null ? { connectStatus } : {}) };
  return { code, diagnostic };
}
