const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const NetworkNode = require('../models/NetworkNode');

function hashAgentToken(plain) {
  return crypto.createHash('sha256').update(String(plain), 'utf8').digest('hex');
}

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 32);
}

function inferConnectionMode(type, explicit) {
  if (explicit === 'DIRECT_API' || explicit === 'REMOTE_AGENT_OUTBOUND') return explicit;
  if (type === 'REMOTE_AGENT') return 'REMOTE_AGENT_OUTBOUND';
  return 'DIRECT_API';
}

exports.listNodes = async (tenantId, opts = {}) => {
  const q = NetworkNode.find({ tenantId }).sort({ name: 1 });
  if (opts.includeAgentFields) {
    q.select('+agentTokenHash');
  }
  return q.lean();
};

exports.getNode = async (tenantId, id, opts = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');
  const q = NetworkNode.findOne({ _id: id, tenantId });
  if (opts.includeAgentFields) q.select('+agentTokenHash');
  const node = await q.lean();
  if (!node) throw ApiError.notFound('NetworkNode não encontrado');
  return node;
};

/**
 * @returns {Promise<object>} node + opcional agentTokenPlain (só criação REMOTE_AGENT)
 */
exports.createNode = async (tenantId, data) => {
  const name = data.name != null ? String(data.name).trim() : '';
  if (!name) throw ApiError.badRequest('name é obrigatório');

  const type = data.type === 'REMOTE_AGENT' ? 'REMOTE_AGENT' : 'LOCAL';
  const code = normalizeCode(data.code || name);
  if (!code) throw ApiError.badRequest('code é obrigatório (ou derivável do name)');

  const connectionMode = inferConnectionMode(type, data.connectionMode);

  const timeoutMs =
    data.timeoutMs !== undefined ? Number(data.timeoutMs) : type === 'REMOTE_AGENT' ? 20000 : 20000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 3000 || timeoutMs > 120000) {
    throw ApiError.badRequest('timeoutMs deve estar entre 3000 e 120000');
  }

  let agentTokenPlain = null;
  let agentTokenHash = null;
  if (type === 'REMOTE_AGENT') {
    agentTokenPlain = crypto.randomBytes(24).toString('base64url');
    agentTokenHash = hashAgentToken(agentTokenPlain);
  }

  const node = await NetworkNode.create({
    tenantId,
    name,
    code,
    type,
    status: 'unknown',
    connectionMode,
    host: data.host != null ? String(data.host).trim() : '',
    config: data.config && typeof data.config === 'object' ? data.config : null,
    timeoutMs,
    isActive: data.isActive === undefined ? true : Boolean(data.isActive),
    agentTokenHash,
  });

  const plain = node.toObject();
  if (agentTokenPlain) {
    return { ...plain, agentTokenPlain, warning: 'Guarde agentTokenPlain com segurança; não será mostrado de novo.' };
  }
  return plain;
};

exports.updateNode = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const existing = await NetworkNode.findOne({ _id: id, tenantId });
  if (!existing) throw ApiError.notFound('NetworkNode não encontrado');

  const $set = {};

  if (data.name !== undefined) {
    const n = String(data.name).trim();
    if (!n) throw ApiError.badRequest('name não pode ser vazio');
    $set.name = n;
  }
  if (data.code !== undefined) {
    const c = normalizeCode(data.code);
    if (!c) throw ApiError.badRequest('code inválido');
    $set.code = c;
  }
  if (data.type !== undefined) {
    $set.type = data.type === 'REMOTE_AGENT' ? 'REMOTE_AGENT' : 'LOCAL';
  }
  if (data.connectionMode !== undefined) {
    const m = String(data.connectionMode);
    if (m !== 'DIRECT_API' && m !== 'REMOTE_AGENT_OUTBOUND') {
      throw ApiError.badRequest('connectionMode inválido');
    }
    $set.connectionMode = m;
  }
  if (data.host !== undefined) $set.host = String(data.host).trim();
  if (data.config !== undefined) {
    $set.config = data.config && typeof data.config === 'object' ? data.config : null;
  }
  if (data.timeoutMs !== undefined) {
    const t = Number(data.timeoutMs);
    if (!Number.isFinite(t) || t < 3000 || t > 120000) {
      throw ApiError.badRequest('timeoutMs deve estar entre 3000 e 120000');
    }
    $set.timeoutMs = t;
  }
  if (data.isActive !== undefined) $set.isActive = Boolean(data.isActive);
  if (data.status !== undefined) {
    const s = String(data.status);
    if (!['unknown', 'online', 'offline'].includes(s)) throw ApiError.badRequest('status inválido');
    $set.status = s;
  }

  if (Object.keys($set).length === 0) {
    return existing.toObject();
  }

  const updated = await NetworkNode.findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true });
  return updated.toObject();
};

exports.deleteNode = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const usedByServer = await mongoose.model('MikrotikServer').findOne({ tenantId, networkNodeId: id }).lean();
  if (usedByServer) {
    throw ApiError.conflict('NetworkNode em uso por um MikrotikServer; remova o vínculo primeiro.', 'NODE_IN_USE');
  }
  const usedByClient = await mongoose.model('Client').findOne({ tenantId, networkNodeId: id }).lean();
  if (usedByClient) {
    throw ApiError.conflict('NetworkNode em uso por um Client; remova o vínculo primeiro.', 'NODE_IN_USE');
  }

  const deleted = await NetworkNode.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('NetworkNode não encontrado');
  return true;
};

exports.verifyAgentCredentials = async (nodeIdPlain, bearerToken) => {
  if (!mongoose.Types.ObjectId.isValid(String(nodeIdPlain))) {
    return { ok: false, reason: 'invalid_node_id' };
  }
  const node = await NetworkNode.findOne({ _id: nodeIdPlain }).select('+agentTokenHash').lean();
  if (!node || !node.isActive || node.type !== 'REMOTE_AGENT') {
    return { ok: false, reason: 'node_not_found_or_inactive' };
  }
  if (!node.agentTokenHash || !bearerToken) {
    return { ok: false, reason: 'missing_token' };
  }
  const digest = hashAgentToken(bearerToken);
  try {
    const a = Buffer.from(digest, 'hex');
    const b = Buffer.from(node.agentTokenHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'token_mismatch' };
    }
  } catch (_) {
    return { ok: false, reason: 'token_mismatch' };
  }
  return { ok: true, node };
};

exports.touchAgentHeartbeat = async (nodeId, meta) => {
  const $set = { agentLastSeenAt: new Date(), status: 'online' };
  if (meta && typeof meta === 'object') {
    $set.agentMeta = meta;
  }
  await NetworkNode.updateOne({ _id: nodeId }, { $set });
};

/**
 * Gera novo token de agente (REMOTE_AGENT). Devolve plain uma única vez.
 * @param {string} tenantId
 * @param {string} id
 */
exports.rotateAgentToken = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');
  const existing = await NetworkNode.findOne({ _id: id, tenantId });
  if (!existing) throw ApiError.notFound('NetworkNode não encontrado');
  if (existing.type !== 'REMOTE_AGENT') {
    throw ApiError.badRequest('Rotação de token só aplica a nós do tipo REMOTE_AGENT.');
  }
  const agentTokenPlain = crypto.randomBytes(24).toString('base64url');
  const agentTokenHash = hashAgentToken(agentTokenPlain);
  await NetworkNode.updateOne({ _id: id, tenantId }, { $set: { agentTokenHash } });
  const node = await NetworkNode.findOne({ _id: id, tenantId }).lean();
  return {
    node,
    agentTokenPlain,
    warning: 'Guarde agentTokenPlain com segurança; não será mostrado de novo.',
  };
};

exports.hashAgentToken = hashAgentToken;
