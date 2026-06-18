const { RouterOSClient } = require('routeros-client');

function envBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function envInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function routerosOptionsFromEnv() {
  const host = String(process.env.MIKROTIK_HOST || '').trim();
  const user = String(process.env.MIKROTIK_USER || '').trim();
  const password = String(process.env.MIKROTIK_PASSWORD || '');
  const port = envInt(process.env.MIKROTIK_PORT, 8728);
  const timeoutMs = envInt(process.env.MIKROTIK_TIMEOUT_MS, 8000);
  const tlsEnabled = envBool(process.env.MIKROTIK_TLS, false);

  if (!host) throw new Error('MIKROTIK_HOST nao configurado.');
  if (!user) throw new Error('MIKROTIK_USER nao configurado.');
  if (!password) throw new Error('MIKROTIK_PASSWORD nao configurado.');

  return {
    host,
    user,
    password,
    port,
    timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
    tls: tlsEnabled ? {} : undefined,
  };
}

async function connectRouteros(options = routerosOptionsFromEnv()) {
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

async function getActivePppoeSessions(connection = null) {
  const ownedConnection = !connection;
  const { api, client } = connection || await connectRouteros();

  try {
    const sessions = await client.menu('/ppp/active').get();
    return (Array.isArray(sessions) ? sessions : []).map(normalizePppoeActiveSession);
  } finally {
    if (ownedConnection && api) await api.close();
  }
}

module.exports = {
  connectRouteros,
  getActivePppoeSessions,
  normalizePppoeActiveSession,
};
