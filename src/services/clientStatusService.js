const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');

const OPERATIONAL_STATUSES = new Set(['pending', 'active', 'disabled']);
const SINGLE_TRANSITIONS = {
  pending: 'active',
  active: 'disabled',
  disabled: 'active',
};

function normalizeIds(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    throw ApiError.badRequest('Selecione ao menos um cliente.');
  }
  if (clientIds.length > 200) {
    throw ApiError.badRequest('A operação em lote aceita no máximo 200 clientes.');
  }

  const unique = [...new Set(clientIds.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw ApiError.badRequest('Um ou mais IDs de cliente são inválidos.');
  }
  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

function normalizeTargetStatus(status) {
  const target = String(status || '').trim().toLowerCase();
  if (target !== 'active' && target !== 'disabled') {
    throw ApiError.badRequest('Status deve ser active ou disabled.');
  }
  return target;
}

async function loadClients(tenantId, clientIds) {
  const rows = await Client.find({ tenantId, _id: { $in: clientIds } }).select('_id status').lean();
  if (rows.length !== clientIds.length) {
    throw ApiError.notFound('Um ou mais clientes não foram encontrados neste tenant.');
  }
  return rows;
}

async function persistStatus(tenantId, rows, targetStatus) {
  const clientIds = rows.map((row) => row._id);

  await Client.updateMany(
    { tenantId, _id: { $in: clientIds } },
    { $set: { status: targetStatus } },
  );

  let accessResult;
  try {
    accessResult = await ClientAccess.updateMany(
      { tenantId, clientId: { $in: clientIds } },
      { $set: { status: targetStatus } },
    );
  } catch (error) {
    await Client.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { _id: row._id, tenantId },
          update: { $set: { status: row.status } },
        },
      })),
    );
    throw error;
  }

  return {
    updatedClients: rows.length,
    updatedAccesses: accessResult.modifiedCount || 0,
    items: rows.map((row) => ({
      id: String(row._id),
      previousStatus: row.status,
      status: targetStatus,
    })),
  };
}

exports.updateOne = async (tenantId, clientId, status) => {
  const [id] = normalizeIds([clientId]);
  const targetStatus = normalizeTargetStatus(status);
  const [client] = await loadClients(tenantId, [id]);
  const expectedTarget = SINGLE_TRANSITIONS[client.status];

  if (!expectedTarget || expectedTarget !== targetStatus) {
    throw ApiError.conflict(
      `Transição de status não permitida: ${client.status} → ${targetStatus}.`,
      'CLIENT_STATUS_TRANSITION_NOT_ALLOWED',
    );
  }

  return persistStatus(tenantId, [client], targetStatus);
};

exports.updateMany = async (tenantId, clientIds, status) => {
  const ids = normalizeIds(clientIds);
  const targetStatus = normalizeTargetStatus(status);
  const rows = await loadClients(tenantId, ids);
  const unsupported = rows.filter((row) => !OPERATIONAL_STATUSES.has(row.status));

  if (unsupported.length > 0) {
    throw ApiError.conflict(
      'A seleção contém clientes com status que exige tratamento individual.',
      'CLIENT_STATUS_BULK_NOT_ALLOWED',
    );
  }

  return persistStatus(tenantId, rows, targetStatus);
};

exports.SINGLE_TRANSITIONS = SINGLE_TRANSITIONS;
