/**
 * Cliente HTTP(S) mínimo para API Cora (Integração Direta mTLS ou Parceria OAuth).
 * Documentação: https://developers.cora.com.br/docs/instrucoes-iniciais
 *
 * Não persistir credenciais aqui — apenas recebe PEMs/caminhos já resolvidos da BillingAccount.
 */

const https = require('https');
const { URL } = require('url');

/** @type {Map<string, { token: string, expiresAtMs: number }>} */
const tokenCache = new Map();

function cacheKey(accountId, mode) {
  return `${String(accountId)}:${mode}`;
}

function scrubLogUrl(u) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch (_) {
    return '[url]';
  }
}

/**
 * @param {import('https').RequestOptions} opts
 * @param {string} [body]
 * @returns {Promise<{ status: number, raw: string }>}
 */
function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (ch) => {
        raw += ch;
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, raw }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Resolve configuração operacional a partir de BillingAccount (credentials + config).
 * @param {object} acc mongoose doc or plain
 */
function resolveCoraAccountConfig(acc) {
  const cfg = (acc && acc.config) || {};
  const cred = (acc && acc.credentials) || {};
  const env = String(cfg.environment || process.env.CORA_ENV || 'stage').toLowerCase() === 'production' ? 'production' : 'stage';

  const modeRaw = String(cred.mode || cfg.mode || '').toLowerCase();
  const hasCert = Boolean((cred.certificatePem || cred.certPem) && (cred.privateKeyPem || cred.keyPem));
  const mode = modeRaw === 'partnership' || (!hasCert && cred.clientSecret) ? 'partnership' : 'direct';

  const clientId = String(cred.clientId || cfg.clientId || '').trim();
  if (!clientId) {
    const err = new Error('CORA_CONFIG: clientId ausente na BillingAccount.credentials');
    err.code = 'CORA_CONFIG';
    throw err;
  }

  const certificatePem = String(cred.certificatePem || cred.certPem || '').trim() || null;
  const privateKeyPem = String(cred.privateKeyPem || cred.keyPem || '').trim() || null;
  const clientSecret = String(cred.clientSecret || '').trim() || null;

  let apiBase;
  let tokenUrl;
  if (mode === 'direct') {
    apiBase =
      String(cfg.apiBaseUrl || '').trim() ||
      (env === 'production'
        ? 'https://matls-clients.api.cora.com.br'
        : 'https://matls-clients.api.stage.cora.com.br');
    tokenUrl = String(cfg.tokenUrl || '').trim() || `${apiBase.replace(/\/$/, '')}/token`;
    if (!certificatePem || !privateKeyPem) {
      const err = new Error('CORA_CONFIG: Integração Direta exige credentials.certificatePem e credentials.privateKeyPem');
      err.code = 'CORA_CONFIG';
      throw err;
    }
  } else {
    apiBase =
      String(cfg.apiBaseUrl || '').trim() ||
      (env === 'production' ? 'https://api.cora.com.br' : 'https://api.stage.cora.com.br');
    tokenUrl =
      String(cfg.tokenUrl || '').trim() ||
      (env === 'production' ? 'https://api.cora.com.br/oauth/token' : 'https://api.stage.cora.com.br/oauth/token');
    if (!clientSecret) {
      const err = new Error('CORA_CONFIG: Parceria exige credentials.clientSecret');
      err.code = 'CORA_CONFIG';
      throw err;
    }
  }

  return { mode, env, clientId, clientSecret, certificatePem, privateKeyPem, apiBase: apiBase.replace(/\/$/, ''), tokenUrl };
}

/**
 * @param {object} acc
 */
async function getCoraAccessToken(acc) {
  const conf = resolveCoraAccountConfig(acc);
  const ck = cacheKey(acc._id, conf.mode);
  const now = Date.now();
  const cached = tokenCache.get(ck);
  if (cached && cached.expiresAtMs > now + 60_000) return cached.token;

  let tokenRes;
  if (conf.mode === 'direct') {
    const u = new URL(conf.tokenUrl);
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(conf.clientId)}`;
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      cert: conf.certificatePem,
      key: conf.privateKeyPem,
    };
    tokenRes = await httpsRequest(opts, body);
  } else {
    const auth = Buffer.from(`${conf.clientId}:${conf.clientSecret}`, 'utf8').toString('base64');
    const u = new URL(conf.tokenUrl);
    const body = 'grant_type=client_credentials';
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    tokenRes = await httpsRequest(opts, body);
  }

  if (tokenRes.status < 200 || tokenRes.status >= 300) {
    const err = new Error(`CORA_TOKEN_HTTP_${tokenRes.status}: ${tokenRes.raw.slice(0, 500)}`);
    err.code = 'CORA_TOKEN';
    err.status = tokenRes.status;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(tokenRes.raw);
  } catch (e) {
    const err = new Error('CORA_TOKEN_PARSE');
    err.code = 'CORA_TOKEN';
    throw err;
  }
  const accessToken = parsed && parsed.access_token ? String(parsed.access_token) : '';
  if (!accessToken) {
    const err = new Error('CORA_TOKEN_MISSING');
    err.code = 'CORA_TOKEN';
    throw err;
  }
  const expiresIn = Number(parsed.expires_in) || 3600;
  tokenCache.set(ck, { token: accessToken, expiresAtMs: now + expiresIn * 1000 });
  return accessToken;
}

/**
 * @param {object} acc BillingAccount
 * @param {object} params
 * @param {string} params.method
 * @param {string} params.path e.g. /v2/invoices
 * @param {object|null} [params.jsonBody]
 * @param {string|null} [params.idempotencyKey]
 */
async function coraApiJson(acc, params) {
  const conf = resolveCoraAccountConfig(acc);
  const token = await getCoraAccessToken(acc);
  const u = new URL(conf.apiBase + params.path);
  const bodyStr = params.jsonBody != null ? JSON.stringify(params.jsonBody) : '';

  /** @type {import('https').RequestOptions} */
  const opts = {
    method: params.method,
    hostname: u.hostname,
    port: u.port || 443,
    path: `${u.pathname}${u.search}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (params.idempotencyKey) {
    opts.headers['Idempotency-Key'] = String(params.idempotencyKey);
  }
  if (conf.mode === 'direct') {
    opts.cert = conf.certificatePem;
    opts.key = conf.privateKeyPem;
  }
  if (bodyStr) {
    opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }

  const res = await httpsRequest(opts, bodyStr || undefined);
  let json = null;
  try {
    json = res.raw ? JSON.parse(res.raw) : null;
  } catch (_) {
    json = null;
  }
  if (res.status < 200 || res.status >= 300) {
    const msg = json && json.message ? String(json.message) : res.raw.slice(0, 800);
    const err = new Error(`CORA_API_${res.status}: ${msg}`);
    err.code = 'CORA_API';
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

function invalidateTokenCacheForAccount(accountId) {
  for (const k of tokenCache.keys()) {
    if (k.startsWith(`${String(accountId)}:`)) tokenCache.delete(k);
  }
}

module.exports = {
  resolveCoraAccountConfig,
  getCoraAccessToken,
  coraApiJson,
  invalidateTokenCacheForAccount,
  scrubLogUrl,
};
