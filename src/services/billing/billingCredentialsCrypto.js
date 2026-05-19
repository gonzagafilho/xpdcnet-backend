/** Criptografia de campos: sempre via encryptionService (formatos enc:b1: legado e enc:b1:k:… versionado). */
const encryptionService = require('../encryptionService');

/** Campos sensíveis em BillingAccount.credentials (compatível com coraApiClient aliases). */
const SENSITIVE_KEYS = new Set([
  'certificatePem',
  'certPem',
  'privateKeyPem',
  'keyPem',
  'clientSecret',
  'accessToken',
  'refreshToken',
  'webhookInboundSecret',
]);

function credentialsContainSecrets(creds) {
  if (!creds || typeof creds !== 'object') return false;
  for (const k of SENSITIVE_KEYS) {
    const v = creds[k];
    if (v != null && String(v).trim() !== '') return true;
  }
  return false;
}

function encryptCredentialsForStorage(creds) {
  if (!creds || typeof creds !== 'object') return creds;
  const out = { ...creds };
  for (const k of Object.keys(out)) {
    if (!SENSITIVE_KEYS.has(k)) continue;
    const v = out[k];
    if (v == null || v === '') continue;
    if (typeof v !== 'string') continue;
    if (encryptionService.isBillingEncrypted(v)) continue;
    out[k] = encryptionService.encryptBillingField(v);
  }
  return out;
}

function decryptCredentialsForUse(creds) {
  if (!creds || typeof creds !== 'object') return creds;
  const out = { ...creds };
  for (const k of Object.keys(out)) {
    if (!SENSITIVE_KEYS.has(k)) continue;
    const v = out[k];
    if (v == null || typeof v !== 'string') continue;
    out[k] = encryptionService.decryptBillingField(v);
  }
  return out;
}

function maskCredentialsForApi(creds) {
  if (!creds || typeof creds !== 'object') return creds;
  const out = { ...creds };
  for (const k of Object.keys(out)) {
    if (!SENSITIVE_KEYS.has(k)) continue;
    const v = out[k];
    if (v == null || v === '') continue;
    out[k] = encryptionService.isBillingEncrypted(String(v)) ? '••enc••' : '••••••••';
  }
  return out;
}

function maskBillingAccountLean(doc) {
  if (!doc) return doc;
  const o = { ...doc };
  if (o.credentials && typeof o.credentials === 'object') {
    o.credentials = maskCredentialsForApi(o.credentials);
  }
  return o;
}

function accountForAdapter(accDoc) {
  const base = accDoc && typeof accDoc.toObject === 'function' ? accDoc.toObject() : { ...accDoc };
  return {
    ...base,
    credentials: decryptCredentialsForUse(base.credentials || {}),
  };
}

module.exports = {
  SENSITIVE_KEYS,
  credentialsContainSecrets,
  encryptCredentialsForStorage,
  decryptCredentialsForUse,
  maskCredentialsForApi,
  maskBillingAccountLean,
  accountForAdapter,
};
