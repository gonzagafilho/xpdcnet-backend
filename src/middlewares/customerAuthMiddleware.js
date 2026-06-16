const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const ApiError = require('../errors/ApiError');
const { getJwtSecret } = require('../config/jwt');

const INACTIVE_STATUSES = new Set(['cancelled', 'disabled']);

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}

function extractClientId(payload) {
  return payload.clientId || payload.customerId || payload.sub || '';
}

function assertCustomerTokenScope(payload, tenantId) {
  const role = payload.role ? String(payload.role).toLowerCase() : '';
  if (role && role !== 'customer' && role !== 'client') return false;
  if (payload.tenantId && String(payload.tenantId) !== String(tenantId)) return false;
  return true;
}

module.exports = async function customerAuthMiddleware(req, res, next) {
  try {
    const secret = getJwtSecret();
    if (!secret) {
      return next(ApiError.serviceUnavailable('Configuracao do servidor incompleta.', 'SERVER_MISCONFIGURED'));
    }

    const token = extractToken(req);
    if (!token) return next(ApiError.unauthorized('Token do cliente ausente'));

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (_) {
      return next(ApiError.unauthorized('Token do cliente invalido'));
    }

    const tenantId = req.tenant && req.tenant._id;
    if (!tenantId) return next(ApiError.unauthorized('Tenant nao resolvido'));
    if (!assertCustomerTokenScope(payload, tenantId)) return next(ApiError.unauthorized('Token nao pertence ao App do Cliente'));

    const clientId = extractClientId(payload);
    if (!clientId || !mongoose.Types.ObjectId.isValid(String(clientId))) {
      return next(ApiError.unauthorized('Token sem cliente valido'));
    }

    const client = await Client.findOne({ _id: clientId, tenantId }).lean();
    if (!client || INACTIVE_STATUSES.has(String(client.status || '').toLowerCase())) {
      return next(ApiError.unauthorized('Cliente inexistente ou inativo'));
    }

    req.customer = {
      tokenPayload: payload,
      client,
      clientId: client._id,
      tenantId,
    };

    next();
  } catch (err) {
    next(err);
  }
};
