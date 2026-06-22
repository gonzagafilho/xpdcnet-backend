const { RouterOSClient } = require('routeros-client');
const { decryptSecret } = require('./networkConcentratorService');

function envInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timeoutSeconds(value) {
  return Math.max(1, Math.ceil(envInt(value, envInt(process.env.MIKROTIK_TIMEOUT_MS, 8000)) / 1000));
}

function routerosOptionsFromConcentrator(concentrator) {
  if (!concentrator) throw new Error('Concentrador RouterOS ausente.');
  const host = String(concentrator.host || '').trim();
  const user = String(concentrator.username || '').trim();
  const password = decryptSecret(concentrator.passwordEncrypted);
  if (!host) throw new Error('Host do concentrador ausente.');
  if (!user) throw new Error('Usuario do concentrador ausente.');
  if (!password) throw new Error('Senha do concentrador ausente.');
  return {
    host,
    user,
    password,
    port: envInt(concentrator.port, concentrator.tls ? 8729 : 8728),
    timeout: timeoutSeconds(concentrator.metadata?.routerosTimeoutMs || concentrator.metadata?.timeoutMs),
    tls: concentrator.tls ? {} : undefined,
  };
}

async function connectRouteros(options) {
  if (!options || !options.host || !options.user || !options.password) {
    throw new Error('Opcoes RouterOS do concentrador ausentes.');
  }
  const api = new RouterOSClient(options);
  const client = await api.connect();
  return { api, client };
}

function numberFromSession(session, keys = []) {
  if (!session || typeof session !== 'object') return 0;
  for (const key of keys) {
    if (session[key] == null || String(session[key]).trim() === '') continue;
    const value = Number(session[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function normalizePppoeActiveSession(session = {}) {
  return {
    username: String(session.name || session.user || session.username || '').trim(),
    currentIp: String(session.address || session.remoteAddress || session['remote-address'] || '').trim() || null,
    uptime: String(session.uptime || '').trim() || null,
    service: String(session.service || '').trim() || null,
    callerId: String(session.callerId || session['caller-id'] || '').trim() || null,
    downloadBytes: numberFromSession(session, ['bytes-out', 'bytesOut', 'txBytes', 'tx-bytes']),
    uploadBytes: numberFromSession(session, ['bytes-in', 'bytesIn', 'rxBytes', 'rx-bytes']),
    rawRate: String(session.encoding || session.rate || session['rate-limit'] || '').trim() || null,
    source: 'mikrotik',
  };
}

async function getActivePppoeSessions(connection) {
  if (!connection?.client) throw new Error('Conexao RouterOS ausente.');
  const sessions = await connection.client.menu('/ppp/active').get();
  return (Array.isArray(sessions) ? sessions : []).map(normalizePppoeActiveSession);
}

async function getPppoeStateFromConcentrator(concentrator) {
  const connection = await connectRouteros(routerosOptionsFromConcentrator(concentrator));
  try {
    const [activeSessions, secrets] = await Promise.all([
      getActivePppoeSessions(connection),
      connection.client.menu('/ppp/secret').get(),
    ]);
    return {
      activeSessions,
      secretUsernames: (Array.isArray(secrets) ? secrets : [])
        .map((row) => String(row.name || '').trim().toLowerCase())
        .filter(Boolean),
    };
  } finally {
    await connection.api.close().catch(() => {});
  }
}

module.exports = {
  connectRouteros,
  getActivePppoeSessions,
  getPppoeStateFromConcentrator,
  routerosOptionsFromConcentrator,
  normalizePppoeActiveSession,
};
