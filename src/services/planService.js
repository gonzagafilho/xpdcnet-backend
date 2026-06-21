const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Plan = require('../models/Plan');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');
const Invoice = require('../models/Invoice');
const NetworkNode = require('../models/NetworkNode');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const MikrotikServer = require('../models/MikrotikServer');

function asObjectId(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest(`${field} inválido`);
  return value;
}

function numberValue(value, field, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw ApiError.badRequest(`${field} inválido`);
  return parsed;
}

function normalizePayload(data, { creating = false } = {}) {
  const payload = {};
  const name = data.name !== undefined ? String(data.name).trim() : undefined;
  const speed = data.downloadMbps !== undefined ? data.downloadMbps : data.speedMbps;
  const price = data.monthlyPrice !== undefined ? data.monthlyPrice : data.price;

  if (creating && (!name || speed === undefined || price === undefined)) {
    throw ApiError.badRequest('name, speedMbps e price são obrigatórios');
  }

  if (name !== undefined) {
    if (!name) throw ApiError.badRequest('name é obrigatório');
    payload.name = name;
  }
  if (speed !== undefined) payload.speedMbps = numberValue(speed, 'speedMbps', { min: 0.01 });
  if (data.uploadMbps !== undefined) {
    payload.uploadMbps = data.uploadMbps === null || data.uploadMbps === ''
      ? null
      : numberValue(data.uploadMbps, 'uploadMbps');
  }
  if (price !== undefined) payload.price = numberValue(price, 'price');
  if (data.billingCycle !== undefined) payload.billingCycle = data.billingCycle;
  if (data.authType !== undefined) payload.authType = data.authType;
  if (data.isActive !== undefined) payload.isActive = Boolean(data.isActive);
  if (data.status !== undefined) {
    if (!['active', 'inactive'].includes(String(data.status))) {
      throw ApiError.badRequest('status inválido (use active ou inactive)');
    }
    payload.isActive = String(data.status) === 'active';
  }

  const networkNodeId = asObjectId(data.networkNodeId ?? data.nodeId, 'networkNodeId');
  const serverId = asObjectId(data.serverId, 'serverId');
  const concentratorId = asObjectId(data.concentratorId, 'concentratorId');
  if (networkNodeId !== undefined) payload.networkNodeId = networkNodeId;
  if (serverId !== undefined) payload.serverId = serverId;
  if (concentratorId !== undefined) payload.concentratorId = concentratorId;
  if (data.popName !== undefined) payload.popName = String(data.popName || '').trim();
  if (data.description !== undefined) payload.description = String(data.description || '').trim();
  if (data.mikrotik !== undefined) payload.mikrotik = data.mikrotik || {};
  if (data.routerosProfileName !== undefined) {
    payload['mikrotik.profile'] = String(data.routerosProfileName || '').trim();
  }

  return payload;
}

async function assertNetworkReferences(tenantId, payload) {
  if (payload.serverId) {
    const server = await MikrotikServer.exists({ _id: payload.serverId, tenantId });
    if (!server) throw ApiError.notFound('Concentrador não encontrado para este tenant');
  }
  if (payload.networkNodeId) {
    const node = await NetworkNode.exists({ _id: payload.networkNodeId, tenantId });
    if (!node) throw ApiError.notFound('Node não encontrado para este tenant');
  }
  if (payload.concentratorId) {
    const concentrator = await NetworkConcentrator.exists({ _id: payload.concentratorId, tenantId });
    if (!concentrator) throw ApiError.notFound('Concentrador não encontrado para este tenant');
  }
}

async function enrichPlans(tenantId, plans) {
  const plainPlans = plans.map((plan) => (plan.toObject ? plan.toObject() : plan));
  const planIds = plainPlans.map((plan) => plan._id);
  if (!planIds.length) return [];

  const [clientCounts, accessRows] = await Promise.all([
    Client.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), planId: { $in: planIds } } },
      { $group: { _id: '$planId', count: { $sum: 1 } } },
    ]),
    ClientAccess.find({ tenantId, planId: { $in: planIds } })
      .select('planId serverId networkNodeId')
      .lean(),
  ]);

  const clientCountByPlan = new Map(clientCounts.map((row) => [String(row._id), row.count]));
  const accessByPlan = new Map();
  const serverIds = new Set();
  const nodeIds = new Set();
  for (const access of accessRows) {
    const key = String(access.planId);
    if (!accessByPlan.has(key)) accessByPlan.set(key, []);
    accessByPlan.get(key).push(access);
    if (access.serverId) serverIds.add(String(access.serverId));
    if (access.networkNodeId) nodeIds.add(String(access.networkNodeId));
  }
  for (const plan of plainPlans) {
    const nodeId = plan.networkNodeId?._id || plan.networkNodeId;
    if (nodeId) nodeIds.add(String(nodeId));
  }

  const [servers, nodes] = await Promise.all([
    MikrotikServer.find({ tenantId, _id: { $in: [...serverIds] } }).select('name host networkNodeId').lean(),
    NetworkNode.find({ tenantId, _id: { $in: [...nodeIds] } }).select('name code').lean(),
  ]);
  const serverById = new Map(servers.map((row) => [String(row._id), row]));
  const nodeById = new Map(nodes.map((row) => [String(row._id), row]));

  return plainPlans.map((plan) => {
    const accesses = accessByPlan.get(String(plan._id)) || [];
    const linkedServers = [...new Set(accesses.map((row) => String(row.serverId || '')).filter(Boolean))]
      .map((id) => serverById.get(id))
      .filter(Boolean)
      .map((row) => ({ id: String(row._id), name: row.name, host: row.host }));
    const linkedNodes = [...new Set(accesses.map((row) => String(row.networkNodeId || '')).filter(Boolean))]
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .map((row) => ({ id: String(row._id), name: row.name, code: row.code }));
    const configuredNodeId = plan.networkNodeId?._id || plan.networkNodeId;
    const configuredNode = configuredNodeId ? nodeById.get(String(configuredNodeId)) : null;
    const configuredServer = plan.serverId && typeof plan.serverId === 'object'
      ? { id: String(plan.serverId._id), name: plan.serverId.name, host: plan.serverId.host }
      : null;
    const explicitConcentrator = plan.concentratorId && typeof plan.concentratorId === 'object'
      ? {
          id: String(plan.concentratorId._id),
          name: plan.concentratorId.name,
          host: plan.concentratorId.host,
          status: plan.concentratorId.status,
          enabled: plan.concentratorId.enabled,
        }
      : null;
    const baseConcentrators = configuredServer
      ? [configuredServer, ...linkedServers.filter((row) => row.id !== configuredServer.id)]
      : linkedServers;
    const concentrators = explicitConcentrator
      ? [explicitConcentrator, ...baseConcentrators.filter((row) => row.id !== explicitConcentrator.id)]
      : baseConcentrators;

    return {
      ...plan,
      downloadMbps: plan.speedMbps,
      monthlyPrice: plan.price,
      status: plan.isActive === false ? 'inactive' : 'active',
      routerosProfileName: plan.mikrotik?.profile || '',
      networkNode: configuredNode
        ? { id: String(configuredNode._id), name: configuredNode.name, code: configuredNode.code }
        : linkedNodes[0] || null,
      linkedNodes,
      linkedConcentrators: concentrators,
      stats: {
        clients: clientCountByPlan.get(String(plan._id)) || 0,
        accesses: accesses.length,
        concentrators: concentrators.length,
      },
    };
  });
}

exports.create = async (tenantId, data) => {
  const payload = normalizePayload(data, { creating: true });
  await assertNetworkReferences(tenantId, payload);
  if (payload['mikrotik.profile'] !== undefined) {
    payload.mikrotik = { ...(payload.mikrotik || {}), profile: payload['mikrotik.profile'] };
    delete payload['mikrotik.profile'];
  }
  const plan = await Plan.create({
    tenantId,
    billingCycle: 'monthly',
    authType: 'pppoe',
    isActive: true,
    ...payload,
  });
  return (await enrichPlans(tenantId, [plan]))[0];
};

exports.list = async (tenantId) => {
  const plans = await Plan.find({ tenantId })
    .populate('serverId', 'name host isActive networkNodeId')
    .populate('concentratorId', 'name host status enabled')
    .sort({ createdAt: -1 });
  return enrichPlans(tenantId, plans);
};

exports.listOptions = async (tenantId) => {
  const [nodes, servers] = await Promise.all([
    NetworkNode.find({ tenantId, isActive: true }).select('name code').sort({ name: 1 }).lean(),
    MikrotikServer.find({ tenantId, isActive: true }).select('name host networkNodeId').sort({ name: 1 }).lean(),
  ]);
  return {
    nodes: nodes.map((row) => ({ id: String(row._id), name: row.name, code: row.code })),
    concentrators: servers.map((row) => ({
      id: String(row._id),
      name: row.name,
      host: row.host,
      networkNodeId: row.networkNodeId ? String(row.networkNodeId) : null,
    })),
  };
};

exports.getById = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');
  const plan = await Plan.findOne({ _id: id, tenantId })
    .populate('serverId', 'name host isActive networkNodeId')
    .populate('concentratorId', 'name host status enabled');
  if (!plan) throw ApiError.notFound('Plano não encontrado');
  return (await enrichPlans(tenantId, [plan]))[0];
};

exports.update = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');
  const payload = normalizePayload(data);
  await assertNetworkReferences(tenantId, payload);

  const updated = await Plan.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: payload },
    { new: true, runValidators: true },
  ).populate('serverId', 'name host isActive networkNodeId')
    .populate('concentratorId', 'name host status enabled');
  if (!updated) throw ApiError.notFound('Plano não encontrado');
  return (await enrichPlans(tenantId, [updated]))[0];
};

exports.updateStatus = async (tenantId, id, status) => {
  return exports.update(tenantId, id, { status });
};

exports.remove = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const [clients, accesses, invoices] = await Promise.all([
    Client.countDocuments({ tenantId, planId: id }),
    ClientAccess.countDocuments({ tenantId, planId: id }),
    Invoice.countDocuments({ tenantId, planId: id }),
  ]);
  if (clients > 0 || accesses > 0) {
    throw ApiError.conflict('Plano possui clientes ou acessos vinculados e não pode ser excluído.');
  }
  if (invoices > 0) {
    throw ApiError.conflict('Plano possui faturas vinculadas e não pode ser excluído.');
  }

  const deleted = await Plan.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('Plano não encontrado');
  return true;
};
