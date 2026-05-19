/**
 * Sessão RouterOS API (porta binária, típica 8728).
 * Usa node-routeros (API de baixo nível). O pacote está «discontinued» no npm;
 * para evolução, avaliar fork ou routeros-client mantido pela mesma família.
 *
 * Nunca regista palavra-passe nem a inclui em mensagens de erro expostas.
 */

const { RouterOSAPI } = require('node-routeros');

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Remove credenciais de texto de erro (defesa em profundidade).
 * @param {string} s
 */
function scrubSecretsFromMessage(s) {
  if (!s || typeof s !== 'string') return String(s);
  return s
    .replace(/password=\S+/gi, 'password=[redacted]')
    .replace(/=password=\S+/gi, '=password=[redacted]');
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function formatConnectError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  return scrubSecretsFromMessage(msg);
}

/**
 * Opções de ligação alinhadas ao modelo MikrotikServer (password nunca logada).
 * @typedef {object} MikrotikServerLike
 * @property {string} host
 * @property {number} [port]
 * @property {string} username — mapeado para API RouterOS `user`
 * @property {string} password
 */

/**
 * Cria uma sessão (ainda não ligada).
 * @param {MikrotikServerLike} server
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 */
function createMikrotikSession(server, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSec = Math.min(120, Math.max(3, Math.ceil(timeoutMs / 1000)));

  const api = new RouterOSAPI({
    host: String(server.host || '').trim(),
    user: String(server.username || ''),
    password: String(server.password || ''),
    port: Number.isFinite(Number(server.port)) && Number(server.port) > 0 ? Number(server.port) : 8728,
    timeout: timeoutSec,
  });

  return {
    /** Liga ao equipamento. */
    async connect() {
      // Sem password nos logs
      console.info(
        '[mikrotikClient] connect host=%s port=%s user=%s',
        api.host,
        api.port,
        server.username != null ? String(server.username) : '',
      );
      try {
        await api.connect();
      } catch (err) {
        const e = new Error(`Falha de ligação RouterOS: ${formatConnectError(err)}`);
        e.cause = err;
        throw e;
      }
      return api;
    },

    /** Encerra sessão (ignora erros secundários). */
    async disconnect() {
      try {
        if (api.connected) {
          await api.close();
        }
      } catch (_) {
        /* intencional */
      }
    },

    /** Instância node-routeros (só após connect). */
    getRawApi() {
      return api;
    },
  };
}

/**
 * Garante connect no início e disconnect no fim; erros propagam após fecho.
 * @param {MikrotikServerLike} server
 * @param {object} [sessionOpts]
 * @param {number} [sessionOpts.timeoutMs]
 * @param {(api: import('node-routeros').RouterOSAPI) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withMikrotikConnection(server, sessionOpts, fn) {
  const opts = sessionOpts || {};
  const session = createMikrotikSession(server, opts);
  await session.connect();
  try {
    return await fn(session.getRawApi());
  } finally {
    await session.disconnect();
  }
}

module.exports = {
  createMikrotikSession,
  withMikrotikConnection,
  scrubSecretsFromMessage,
  formatConnectError,
  DEFAULT_TIMEOUT_MS,
};
