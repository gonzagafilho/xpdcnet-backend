const jwt = require('jsonwebtoken');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const { getJwtSecret } = require('../config/jwt');

const BLOCKED_LOGIN_STATUSES = new Set(['cancelled', 'disabled', 'inactive']);
const CUSTOMER_TOKEN_EXPIRES_IN = '7d';

function onlyDigits(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}


function digitsRegex(digits) {
  return new RegExp(digits.split('').join('\\D*'));
}

function safeClient(client) {
  return {
    _id: String(client._id),
    fullName: client.fullName || '',
    status: client.status || '',
  };
}

function signCustomerToken(client, tenantId) {
  const secret = getJwtSecret();
  if (!secret) {
    throw ApiError.serviceUnavailable('Configuracao do servidor incompleta.', 'SERVER_MISCONFIGURED');
  }

  return jwt.sign(
    {
      role: 'customer',
      clientId: String(client._id),
      tenantId: String(tenantId),
    },
    secret,
    { expiresIn: CUSTOMER_TOKEN_EXPIRES_IN },
  );
}

async function findClientForLogin(tenantId, documentDigits, phoneDigits) {
  const candidates = await Client.find({
    tenantId,
    document: digitsRegex(documentDigits),
    phone: digitsRegex(phoneDigits),
  })
    .select('_id fullName status document phone')
    .limit(20)
    .lean();

  return candidates.find((client) => {
    const clientDocument = onlyDigits(client.document);
    const clientPhone = onlyDigits(client.phone);
    return clientDocument === documentDigits && clientPhone === phoneDigits;
  }) || null;
}

exports.login = async (tenantId, payload = {}) => {
  const documentDigits = onlyDigits(payload.document);
  const phoneDigits = onlyDigits(payload.phone);

  if (!documentDigits) throw ApiError.badRequest('document e obrigatorio');
  if (!phoneDigits) throw ApiError.badRequest('phone e obrigatorio');
  if (documentDigits.length < 11 || documentDigits.length > 14) {
    throw ApiError.badRequest('document invalido');
  }
  if (phoneDigits.length < 10 || phoneDigits.length > 13) {
    throw ApiError.badRequest('phone invalido');
  }

  const client = await findClientForLogin(tenantId, documentDigits, phoneDigits);
  if (!client) throw ApiError.unauthorized('Documento ou WhatsApp invalidos');

  const status = String(client.status || '').toLowerCase();
  if (BLOCKED_LOGIN_STATUSES.has(status)) {
    throw ApiError.unauthorized('Cliente inexistente ou inativo');
  }

  return {
    token: signCustomerToken(client, tenantId),
    client: safeClient(client),
  };
};

exports.me = async (client) => ({ client: safeClient(client) });

exports.onlyDigits = onlyDigits;
exports.CUSTOMER_TOKEN_EXPIRES_IN = CUSTOMER_TOKEN_EXPIRES_IN;

exports.findClientForLogin = findClientForLogin;
exports.signCustomerToken = signCustomerToken;
exports.safeClient = safeClient;
exports.BLOCKED_LOGIN_STATUSES = BLOCKED_LOGIN_STATUSES;
