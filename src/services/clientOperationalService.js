const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');
const Invoice = require('../models/Invoice');
const SupportTicket = require('../models/SupportTicket');
const OperationLog = require('../models/OperationLog');
const MikrotikServer = require('../models/MikrotikServer');
const clientAccessService = require('./clientAccessService');

function objectId(value, field = 'ID') {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest(`${field} inválido`);
  return new mongoose.Types.ObjectId(String(value));
}

function safeClient(client) {
  const row = client && typeof client.toObject === 'function' ? client.toObject() : client;
  const plan = row.planId && typeof row.planId === 'object'
    ? {
        id: String(row.planId._id),
        name: row.planId.name,
        speedMbps: row.planId.speedMbps,
        price: row.planId.price,
      }
    : null;
  return {
    id: String(row._id),
    fullName: row.fullName,
    document: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || {},
    plan,
    monthlyPrice: row.monthlyPrice,
    dueDay: row.dueDay,
    status: row.status,
    notes: row.notes || '',
    contract: row.contract || {},
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

function hasContract(client) {
  const contract = client?.contract || {};
  return Boolean(
    String(contract.paymentMethod || '').trim() ||
    String(contract.contractModel || '').trim() ||
    String(contract.discount || '').trim() ||
    String(contract.surcharge || '').trim() ||
    String(contract.notes || '').trim() ||
    contract.pendingDays != null ||
    contract.blockDays != null
  );
}

exports.hasContract = hasContract;

exports.summary = async (tenantId) => {
  const tid = objectId(tenantId, 'tenantId');
  const rows = await Client.aggregate([
    { $match: { tenantId: tid } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((row) => [String(row._id || 'unknown'), Number(row.count || 0)]));
  const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  return {
    total,
    active: byStatus.active || 0,
    inactive: (byStatus.disabled || 0) + (byStatus.cancelled || 0),
    pending: byStatus.pending || 0,
    byStatus,
  };
};

exports.details = async (tenantId, clientId) => {
  const tid = objectId(tenantId, 'tenantId');
  const cid = objectId(clientId, 'clientId');
  const client = await Client.findOne({ _id: cid, tenantId: tid })
    .select('-access.password')
    .populate('planId', 'name speedMbps price')
    .lean();
  if (!client) throw ApiError.notFound('Cliente não encontrado');

  const [accesses, invoices, tickets, logs] = await Promise.all([
    clientAccessService.listByClient(tid, cid),
    Invoice.find({ tenantId: tid, clientId: cid })
      .select('amount dueDate status competence description paidAt createdAt updatedAt')
      .sort({ dueDate: -1 })
      .limit(50)
      .lean(),
    SupportTicket.find({ tenantId: tid, clientId: cid })
      .select('protocol subject status createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    OperationLog.find({ tenantId: tid, targetId: String(cid) })
      .select('action status createdAt errorMessage')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
  ]);

  return {
    client: safeClient(client),
    accesses,
    invoices: invoices.map((row) => ({
      id: String(row._id),
      amount: row.amount,
      dueDate: row.dueDate,
      status: row.status,
      competence: row.competence,
      description: row.description || '',
      paidAt: row.paidAt || null,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
    })),
    tickets: tickets.map((row) => ({
      protocol: row.protocol,
      subject: row.subject,
      status: row.status,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
    })),
    logs: logs.map((row) => ({
      action: row.action,
      status: row.status,
      errorMessage: row.errorMessage || '',
      createdAt: row.createdAt || null,
    })),
    attachments: [],
  };
};

exports.deletionBlockers = async (tenantId, clientId) => {
  const tid = objectId(tenantId, 'tenantId');
  const cid = objectId(clientId, 'clientId');
  const client = await Client.findOne({ _id: cid, tenantId: tid }).select('contract').lean();
  if (!client) throw ApiError.notFound('Cliente não encontrado');
  const [accesses, invoices] = await Promise.all([
    ClientAccess.countDocuments({ tenantId: tid, clientId: cid }),
    Invoice.countDocuments({ tenantId: tid, clientId: cid }),
  ]);
  return { accesses, contract: hasContract(client), invoices };
};

exports.assertCanDelete = async (tenantId, clientId) => {
  const blockers = await exports.deletionBlockers(tenantId, clientId);
  if (blockers.accesses > 0 || blockers.contract || blockers.invoices > 0) {
    throw ApiError.conflict('Cliente possui vínculos operacionais e não pode ser excluído diretamente.');
  }
  return blockers;
};

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

exports.exportCsv = async (tenantId, query = {}) => {
  const tid = objectId(tenantId, 'tenantId');
  const filter = { tenantId: tid };
  const serverId = query.serverId ? objectId(query.serverId, 'serverId') : null;
  if (serverId) {
    const clientIds = await ClientAccess.distinct('clientId', { tenantId: tid, serverId });
    filter._id = { $in: clientIds };
  }
  const clients = await Client.find(filter)
    .select('fullName document phone email status planId dueDay access.username')
    .populate('planId', 'name')
    .sort({ fullName: 1 })
    .lean();
  const server = serverId
    ? await MikrotikServer.findOne({ _id: serverId, tenantId: tid }).select('name').lean()
    : null;
  const header = ['id', 'nome', 'email', 'cpf_cnpj', 'telefone', 'plano', 'status', 'vencimento', 'login_pppoe', 'concentrador'];
  const lines = clients.map((client) => [
    client._id,
    client.fullName,
    client.email,
    client.document,
    client.phone,
    client.planId?.name || '',
    client.status,
    client.dueDay,
    client.access?.username || '',
    server?.name || '',
  ].map(csvCell).join(','));
  return {
    filename: server ? `clientes-${server.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv` : 'clientes-xpdcnet.csv',
    content: `\uFEFF${header.join(',')}\n${lines.join('\n')}\n`,
  };
};
