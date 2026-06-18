const crypto = require('crypto');
const ApiError = require('../errors/ApiError');
const CustomerTrustedDevice = require('../models/CustomerTrustedDevice');
const { getJwtSecret } = require('../config/jwt');
const customerAuthService = require('./customerAuthService');

const TRUSTED_DEVICE_TTL_DAYS = 90;
const TRUSTED_DEVICE_TOKEN_BYTES = 32;

function hashTrustedDeviceToken(token) {
  const secret = getJwtSecret();
  if (!secret) throw ApiError.serviceUnavailable('Configuracao do servidor incompleta.', 'SERVER_MISCONFIGURED');
  return crypto.createHmac('sha256', secret).update(String(token || '')).digest('hex');
}

function normalizeUserAgent(value) {
  return String(value || '').slice(0, 500);
}

function trustedDeviceExpiry(now = new Date()) {
  return new Date(now.getTime() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function createTrustedDevice({ tenantId, client, documentDigits, phoneDigits, userAgent }) {
  const trustedDeviceToken = crypto.randomBytes(TRUSTED_DEVICE_TOKEN_BYTES).toString('hex');
  const trustedDeviceExpiresAt = trustedDeviceExpiry();
  const tokenHash = hashTrustedDeviceToken(trustedDeviceToken);

  await CustomerTrustedDevice.create({
    tenantId,
    clientId: client._id,
    document: documentDigits,
    phone: phoneDigits,
    tokenHash,
    userAgent: normalizeUserAgent(userAgent),
    expiresAt: trustedDeviceExpiresAt,
  });

  return {
    trustedDeviceToken,
    trustedDeviceExpiresAt: trustedDeviceExpiresAt.toISOString(),
  };
}

async function loginWithTrustedDevice(tenantId, payload = {}, options = {}) {
  const documentDigits = customerAuthService.onlyDigits(payload.document);
  const phoneDigits = customerAuthService.onlyDigits(payload.phone || payload.whatsapp);
  const trustedDeviceToken = String(payload.trustedDeviceToken || '').trim();

  if (!documentDigits) throw ApiError.badRequest('document e obrigatorio');
  if (!phoneDigits) throw ApiError.badRequest('phone e obrigatorio');
  if (!trustedDeviceToken) throw ApiError.unauthorized('Dispositivo nao reconhecido. Solicite um novo codigo.');

  const client = await customerAuthService.findClientForLogin(tenantId, documentDigits, phoneDigits);
  if (!client) throw ApiError.unauthorized('Documento ou WhatsApp invalidos');

  const status = String(client.status || '').toLowerCase();
  if (customerAuthService.BLOCKED_LOGIN_STATUSES.has(status)) {
    throw ApiError.unauthorized('Cliente inexistente ou inativo');
  }

  const tokenHash = hashTrustedDeviceToken(trustedDeviceToken);
  const now = new Date();
  const trustedDevice = await CustomerTrustedDevice.findOne({
    tenantId,
    clientId: client._id,
    document: documentDigits,
    phone: phoneDigits,
    tokenHash,
    revokedAt: null,
    expiresAt: { $gt: now },
  });

  if (!trustedDevice) {
    throw ApiError.unauthorized('Dispositivo nao reconhecido. Solicite um novo codigo.');
  }

  trustedDevice.lastUsedAt = now;
  trustedDevice.userAgent = normalizeUserAgent(options.userAgent || trustedDevice.userAgent);
  await trustedDevice.save();

  return {
    token: customerAuthService.signCustomerToken(client, tenantId),
    client: customerAuthService.safeClient(client),
  };
}

module.exports = {
  TRUSTED_DEVICE_TTL_DAYS,
  createTrustedDevice,
  hashTrustedDeviceToken,
  loginWithTrustedDevice,
  trustedDeviceExpiry,
};
