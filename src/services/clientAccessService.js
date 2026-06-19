const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');

function safeAccess(value) {
  return {
    id: String(value._id),
    clientId: String(value.clientId?._id || value.clientId),
    server: value.serverId && typeof value.serverId === 'object'
      ? { id: String(value.serverId._id), name: value.serverId.name, host: value.serverId.host }
      : { id: String(value.serverId), name: '', host: '' },
    networkNode: value.networkNodeId && typeof value.networkNodeId === 'object'
      ? { id: String(value.networkNodeId._id), name: value.networkNodeId.name, code: value.networkNodeId.code }
      : null,
    plan: value.planId && typeof value.planId === 'object'
      ? { id: String(value.planId._id), name: value.planId.name, speedMbps: value.planId.speedMbps, price: value.planId.price }
      : { id: String(value.planId), name: '', speedMbps: null, price: null },
    authType: value.authType,
    username: value.username,
    status: value.status,
    source: value.source,
    importedFrom: value.importedFrom || '',
    importedAt: value.importedAt || null,
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null,
  };
}

exports.listByClient = async (tenantId, clientId) => {
  if (!mongoose.Types.ObjectId.isValid(String(clientId))) throw ApiError.badRequest('ID do cliente inválido.');
  const client = await Client.findOne({ _id: clientId, tenantId }).select('_id').lean();
  if (!client) throw ApiError.notFound('Cliente não encontrado.');
  const rows = await ClientAccess.find({ tenantId, clientId })
    .select('-password')
    .populate('serverId', 'name host')
    .populate('networkNodeId', 'name code')
    .populate('planId', 'name speedMbps price')
    .sort({ createdAt: 1 })
    .lean();
  return rows.map(safeAccess);
};

exports.safeAccess = safeAccess;
