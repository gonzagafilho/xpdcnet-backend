const crypto = require('crypto');
const ApiError = require('../errors/ApiError');
const CustomerOtp = require('../models/CustomerOtp');
const { getJwtSecret } = require('../config/jwt');
const customerAuthService = require('./customerAuthService');

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function normalize(payload = {}) {
  const documentDigits = customerAuthService.onlyDigits(payload.document);
  const phoneDigits = customerAuthService.onlyDigits(payload.phone);
  if (!documentDigits) throw ApiError.badRequest('document e obrigatorio');
  if (!phoneDigits) throw ApiError.badRequest('phone e obrigatorio');
  if (documentDigits.length < 11 || documentDigits.length > 14) throw ApiError.badRequest('document invalido');
  if (phoneDigits.length < 10 || phoneDigits.length > 13) throw ApiError.badRequest('phone invalido');
  return { documentDigits, phoneDigits };
}

function normalizeCode(value) {
  const code = customerAuthService.onlyDigits(value);
  if (!code) throw ApiError.badRequest('code e obrigatorio');
  if (code.length !== 6) throw ApiError.badRequest('code invalido');
  return code;
}

function hashCode(code, tenantId, clientId, phone) {
  const secret = getJwtSecret();
  if (!secret) throw ApiError.serviceUnavailable('Configuracao do servidor incompleta.', 'SERVER_MISCONFIGURED');
  return crypto
    .createHmac('sha256', secret)
    .update(`${tenantId}:${clientId}:${phone}:${code}`)
    .digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function canExposeDevCode() {
  return process.env.NODE_ENV !== 'production' || String(process.env.CUSTOMER_OTP_DEV_MODE || '').toLowerCase() === 'true';
}

async function resolveClient(tenantId, payload) {
  const { documentDigits, phoneDigits } = normalize(payload);
  const client = await customerAuthService.findClientForLogin(tenantId, documentDigits, phoneDigits);
  if (!client) throw ApiError.unauthorized('Documento ou WhatsApp invalidos');

  const status = String(client.status || '').toLowerCase();
  if (customerAuthService.BLOCKED_LOGIN_STATUSES.has(status)) {
    throw ApiError.unauthorized('Cliente inexistente ou inativo');
  }

  return { client, documentDigits, phoneDigits };
}

exports.requestOtp = async (tenantId, payload = {}) => {
  const { client, phoneDigits } = await resolveClient(tenantId, payload);
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  await CustomerOtp.updateMany(
    { tenantId, clientId: client._id, phone: phoneDigits, usedAt: null },
    { $set: { usedAt: now } },
  );

  await CustomerOtp.create({
    tenantId,
    clientId: client._id,
    phone: phoneDigits,
    codeHash: hashCode(code, tenantId, client._id, phoneDigits),
    expiresAt,
    maxAttempts: MAX_ATTEMPTS,
  });

  const response = { ok: true, message: 'Codigo enviado para o WhatsApp informado.' };
  if (canExposeDevCode()) response.devCode = code;
  return response;
};

exports.verifyOtp = async (tenantId, payload = {}) => {
  const { client, phoneDigits } = await resolveClient(tenantId, payload);
  const code = normalizeCode(payload.code);
  const now = new Date();

  const otp = await CustomerOtp.findOne({
    tenantId,
    clientId: client._id,
    phone: phoneDigits,
    usedAt: null,
    expiresAt: { $gt: now },
  })
    .select('+codeHash')
    .sort({ createdAt: -1 })
    .lean();

  if (!otp) throw ApiError.unauthorized('Codigo expirado ou invalido');
  if (Number(otp.attempts || 0) >= Number(otp.maxAttempts || MAX_ATTEMPTS)) {
    throw ApiError.unauthorized('Limite de tentativas excedido');
  }

  const expectedHash = hashCode(code, tenantId, client._id, phoneDigits);
  const valid = crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(otp.codeHash));

  if (!valid) {
    await CustomerOtp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw ApiError.unauthorized('Codigo invalido');
  }

  await CustomerOtp.updateOne({ _id: otp._id }, { $set: { usedAt: now }, $inc: { attempts: 1 } });

  return {
    token: customerAuthService.signCustomerToken(client, tenantId),
    client: customerAuthService.safeClient(client),
  };
};
