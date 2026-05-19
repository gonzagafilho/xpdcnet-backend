const crypto = require('crypto');
const mongoose = require('mongoose');
const systemConfigService = require('./systemConfigService');

const ENC_PREFIX = 'enc:v1:';
/**
 * Prefixo de credenciais billing (versão de algoritmo). Não alterar sem migração.
 *
 * Formatos suportados (todos começam com enc:b1:):
 * - Legado (sem keyId): enc:b1:<ivB64>:<tagB64>:<cipherB64>  (3 segmentos após o prefixo)
 * - Versionado (rotação): enc:b1:k:<keyId>:<ivB64>:<tagB64>:<cipherB64>  (marcador literal "k")
 *
 * Variáveis de ambiente — modo anel (empresa / rotação):
 * - BILLING_SECRET_KEYS_JSON: objeto JSON {"id":"material",...} (obrigatório no modo anel)
 * - BILLING_SECRET_ACTIVE_KEY_ID: id da chave usada em encrypt (obrigatório no modo anel)
 *
 * Modo legado (compatível com instalações actuais): se JSON + ACTIVE não estiverem ambos definidos,
 * usa-se BILLING_SECRET_KEY com fallback para MIKROTIK_SECRET_KEY,
 * encrypt produz o formato de 3 segmentos e decrypt usa essa única chave derivada.
 *
 * Decrypt no modo anel, formato legado de 3 segmentos: tenta todas as chaves do anel até AES-GCM validar
 * (ordem: chave activa primeiro, depois restantes por id ordenado).
 */
const BILLING_ENC_PREFIX = 'enc:b1:';
const BILLING_KEYED_MARKER = 'k';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/** Após hydrate: preferência BD → .env (fallback). Antes do primeiro hydrate: só .env. */
let _mikrotikHydrated = false;
let _mikrotikDbSecret = null;

/**
 * Carrega MIKROTIK_SECRET_KEY da base (idempotente). Não regista o valor.
 */
async function hydrateMikrotikSecretFromDatabase() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const fromDb = await systemConfigService.getMikrotikSecretKeyFromDb();
  _mikrotikDbSecret = fromDb;
  _mikrotikHydrated = true;
  _billingRingCacheSig = '';
}

async function reloadMikrotikSecretFromDatabase() {
  _mikrotikHydrated = false;
  _mikrotikDbSecret = null;
  await hydrateMikrotikSecretFromDatabase();
}

function resolveMikrotikSecretMaterial() {
  if (_mikrotikHydrated) {
    if (_mikrotikDbSecret && String(_mikrotikDbSecret).trim()) return String(_mikrotikDbSecret).trim();
    const env = process.env.MIKROTIK_SECRET_KEY != null ? String(process.env.MIKROTIK_SECRET_KEY).trim() : '';
    return env || null;
  }
  const env = process.env.MIKROTIK_SECRET_KEY != null ? String(process.env.MIKROTIK_SECRET_KEY).trim() : '';
  return env || null;
}

function isMikrotikSecretConfigured() {
  return Boolean(resolveMikrotikSecretMaterial());
}

function getKeyOrThrow() {
  const raw = resolveMikrotikSecretMaterial();
  if (!raw || !String(raw).trim()) {
    const e = new Error('Sistema precisa ser configurado.');
    e.code = 'SYSTEM_NOT_CONFIGURED';
    throw e;
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encrypt(text) {
  if (text == null) return '';
  const plain = String(text);
  if (isEncrypted(plain)) return plain;

  const key = getKeyOrThrow();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(text) {
  if (text == null) return '';
  const raw = String(text);
  if (!isEncrypted(raw)) return raw;

  const payload = raw.slice(ENC_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    const e = new Error('Payload de credencial criptografada inválido.');
    e.code = 'INVALID_ENCRYPTED_PAYLOAD';
    throw e;
  }

  const [ivB64, tagB64, dataB64] = parts;
  try {
    const key = getKeyOrThrow();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return plain;
  } catch (err) {
    const e = new Error('Falha ao descriptografar credencial MikroTik.');
    e.code = err && err.code ? err.code : 'DECRYPT_FAILED';
    throw e;
  }
}

function isBillingEncrypted(value) {
  return typeof value === 'string' && value.startsWith(BILLING_ENC_PREFIX);
}

function deriveKeyMaterial(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

let _billingRingCacheSig = '';
let _billingRingCache = null;

function billingEnvSignature() {
  const mat = resolveMikrotikSecretMaterial() || '';
  const matSig = mat ? crypto.createHash('sha256').update(mat).digest('hex').slice(0, 16) : '';
  return [
    process.env.BILLING_SECRET_KEYS_JSON || '',
    process.env.BILLING_SECRET_ACTIVE_KEY_ID || '',
    process.env.BILLING_SECRET_KEY || '',
    process.env.MIKROTIK_SECRET_KEY || '',
    matSig,
  ].join('\x1e');
}

/**
 * @returns {{ mode: 'ring', keys: Record<string, Buffer>, activeId: string, tryOrder: string[] } | { mode: 'legacy', keys: { legacy: Buffer }, activeId: 'legacy', tryOrder: ['legacy'] }}
 */
function getBillingKeyRing() {
  const sig = billingEnvSignature();
  if (_billingRingCache && _billingRingCacheSig === sig) {
    return _billingRingCache;
  }

  const jsonRaw = process.env.BILLING_SECRET_KEYS_JSON;
  const activeIdRaw = process.env.BILLING_SECRET_ACTIVE_KEY_ID;
  const hasJson = jsonRaw != null && String(jsonRaw).trim() !== '';
  const hasActive = activeIdRaw != null && String(activeIdRaw).trim() !== '';

  if (hasJson !== hasActive) {
    const e = new Error(
      'Configuração incompleta: use BILLING_SECRET_KEYS_JSON e BILLING_SECRET_ACTIVE_KEY_ID em conjunto (modo rotação), ou omita ambos para o modo legado (BILLING_SECRET_KEY / MIKROTIK_SECRET_KEY).',
    );
    e.code = 'BILLING_KEY_CONFIG_INCOMPLETE';
    throw e;
  }

  if (hasJson && hasActive) {
    let parsed;
    try {
      parsed = JSON.parse(String(jsonRaw));
    } catch (_) {
      const e = new Error('BILLING_SECRET_KEYS_JSON não é JSON válido.');
      e.code = 'BILLING_KEYS_JSON_INVALID';
      throw e;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const e = new Error('BILLING_SECRET_KEYS_JSON deve ser um objecto id → segredo.');
      e.code = 'BILLING_KEYS_JSON_INVALID';
      throw e;
    }

    const activeId = String(activeIdRaw).trim();
    const keys = {};
    for (const [id, secret] of Object.entries(parsed)) {
      const kid = String(id).trim();
      if (!kid || !/^[a-zA-Z0-9._-]{1,64}$/.test(kid)) continue;
      if (secret == null || !String(secret).trim()) continue;
      keys[kid] = deriveKeyMaterial(secret);
    }

    if (!keys[activeId]) {
      const e = new Error(
        `BILLING_SECRET_ACTIVE_KEY_ID «${activeId}» não existe em BILLING_SECRET_KEYS_JSON ou segredo vazio.`,
      );
      e.code = 'BILLING_ACTIVE_KEY_UNKNOWN';
      throw e;
    }

    const allIds = Object.keys(keys).sort();
    const tryOrder = [activeId, ...allIds.filter((id) => id !== activeId)];

    _billingRingCache = { mode: 'ring', keys, activeId, tryOrder };
    _billingRingCacheSig = sig;
    return _billingRingCache;
  }

  const raw = process.env.BILLING_SECRET_KEY || resolveMikrotikSecretMaterial();
  if (!raw || !String(raw).trim()) {
    const e = new Error(
      'Credenciais billing: defina BILLING_SECRET_KEYS_JSON + BILLING_SECRET_ACTIVE_KEY_ID, ou BILLING_SECRET_KEY / MIKROTIK_SECRET_KEY (modo legado).',
    );
    e.code = 'MISSING_BILLING_SECRET_KEY';
    throw e;
  }

  const legacyBuf = deriveKeyMaterial(raw);
  _billingRingCache = {
    mode: 'legacy',
    keys: { legacy: legacyBuf },
    activeId: 'legacy',
    tryOrder: ['legacy'],
  };
  _billingRingCacheSig = sig;
  return _billingRingCache;
}

function parseBillingCipherPayload(raw) {
  const body = raw.slice(BILLING_ENC_PREFIX.length);
  const parts = body.split(':');
  if (parts.length === 3) {
    return { variant: 'legacy', ivB64: parts[0], tagB64: parts[1], dataB64: parts[2], keyId: null };
  }
  if (
    parts.length === 5 &&
    parts[0] === BILLING_KEYED_MARKER &&
    parts[1] &&
    /^[a-zA-Z0-9._-]{1,64}$/.test(parts[1])
  ) {
    return {
      variant: 'keyed',
      keyId: parts[1],
      ivB64: parts[2],
      tagB64: parts[3],
      dataB64: parts[4],
    };
  }
  return { variant: 'invalid' };
}

function tryDecryptBillingWithKey(keyBuf, ivB64, tagB64, dataB64) {
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function encryptBillingField(text) {
  if (text == null) return '';
  const plain = String(text);
  if (!plain) return '';
  if (isBillingEncrypted(plain)) return plain;

  const ring = getBillingKeyRing();
  const iv = crypto.randomBytes(IV_BYTES);
  let keyBuf;
  if (ring.mode === 'ring') {
    keyBuf = ring.keys[ring.activeId];
  } else {
    keyBuf = ring.keys.legacy;
  }

  const cipher = crypto.createCipheriv(ALGO, keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ivB64 = iv.toString('base64');
  const tagB64 = tag.toString('base64');
  const dataB64 = encrypted.toString('base64');

  if (ring.mode === 'ring') {
    return `${BILLING_ENC_PREFIX}${BILLING_KEYED_MARKER}:${ring.activeId}:${ivB64}:${tagB64}:${dataB64}`;
  }
  return `${BILLING_ENC_PREFIX}${ivB64}:${tagB64}:${dataB64}`;
}

function decryptBillingField(text) {
  if (text == null) return '';
  const raw = String(text);
  if (!isBillingEncrypted(raw)) return raw;

  const parsed = parseBillingCipherPayload(raw);
  if (parsed.variant === 'invalid') {
    const e = new Error('Payload de credencial billing criptografada inválido (formato desconhecido).');
    e.code = 'INVALID_BILLING_ENCRYPTED_PAYLOAD';
    throw e;
  }

  const ring = getBillingKeyRing();

  if (parsed.variant === 'keyed') {
    const keyBuf = ring.keys[parsed.keyId];
    if (!keyBuf) {
      const e = new Error(
        `Chave billing «${parsed.keyId}» não disponível no ambiente (BILLING_SECRET_KEYS_JSON). Impossível descriptografar.`,
      );
      e.code = 'BILLING_DECRYPT_KEY_MISSING';
      throw e;
    }
    try {
      return tryDecryptBillingWithKey(keyBuf, parsed.ivB64, parsed.tagB64, parsed.dataB64);
    } catch (err) {
      const e = new Error('Falha ao descriptografar credencial billing (chave ou integridade).');
      e.code = err && err.code ? err.code : 'BILLING_DECRYPT_FAILED';
      throw e;
    }
  }

  const errors = [];
  for (const kid of ring.tryOrder) {
    const keyBuf = ring.keys[kid];
    if (!keyBuf) continue;
    try {
      return tryDecryptBillingWithKey(keyBuf, parsed.ivB64, parsed.tagB64, parsed.dataB64);
    } catch (_) {
      errors.push(kid);
    }
  }

  const e = new Error(
    'Falha ao descriptografar credencial billing (formato legado): nenhuma chave do anel validou o ciphertext. Inclua a chave histórica em BILLING_SECRET_KEYS_JSON.',
  );
  e.code = 'BILLING_DECRYPT_FAILED';
  throw e;
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  ENC_PREFIX,
  isBillingEncrypted,
  encryptBillingField,
  decryptBillingField,
  BILLING_ENC_PREFIX,
  /** Exposto para scripts de migração validarem o ambiente sem encriptar dados. */
  getBillingKeyRing,
  hydrateMikrotikSecretFromDatabase,
  reloadMikrotikSecretFromDatabase,
  isMikrotikSecretConfigured,
};
