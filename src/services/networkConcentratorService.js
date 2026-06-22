const crypto = require('crypto');
const mongoose = require('mongoose');

const ApiError = require('../errors/ApiError');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const NetworkNode = require('../models/NetworkNode');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');
const remoteAgentCommandService = require('./remoteAgentCommandService');

const NETWORK_CONCENTRATOR_TYPES = NetworkConcentrator.NETWORK_CONCENTRATOR_TYPES;
const NETWORK_CONCENTRATOR_PROTOCOLS = NetworkConcentrator.NETWORK_CONCENTRATOR_PROTOCOLS;
const NETWORK_CONCENTRATOR_STATUSES = NetworkConcentrator.NETWORK_CONCENTRATOR_STATUSES;

const SENSITIVE_KEY_RE = /(password|passwd|secret|token|credential|apiKey|apikey|privateKey)/i;

function getTenantId(authContext) {
  const tenantId = authContext?.tenantId || authContext?.tenant?._id || authContext;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    throw ApiError.badRequest('Tenant inválido para concentrador.');
  }
  return String(tenantId);
}

function normalizeString(value, max = 255) {
  return value == null ? '' : String(value).trim().slice(0, max);
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw ApiError.badRequest(`${label} inválido.`);
  }
}

function getSecretKey() {
  const secret = process.env.XPDCNET_SECRET_KEY || process.env.APP_SECRET;
  if (!secret || String(secret).trim().length < 16) {
    throw ApiError.serviceUnavailable(
      'Chave de criptografia do concentrador não configurada.',
      'NETWORK_CONCENTRATOR_SECRET_NOT_CONFIGURED',
    );
  }
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function safeMetadata(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return {};
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => (
      item && typeof item === 'object' ? safeMetadata(item, depth + 1) : item
    ));
  }

  return Object.entries(value).reduce((acc, [key, item]) => {
    const safeKey = normalizeString(key, 80);
    if (!safeKey || SENSITIVE_KEY_RE.test(safeKey)) return acc;

    if (item && typeof item === 'object') {
      acc[safeKey] = safeMetadata(item, depth + 1);
      return acc;
    }

    if (typeof item === 'string') {
      acc[safeKey] = item.slice(0, 500);
      return acc;
    }

    if (typeof item === 'number' || typeof item === 'boolean' || item == null) {
      acc[safeKey] = item;
    }
    return acc;
  }, {});
}

function encryptSecret(value) {
  const plain = normalizeString(value, 4096);
  if (!plain) {
    throw ApiError.badRequest('Senha do concentrador é obrigatória.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    'enc',
    'nc1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

function decryptSecret(value) {
  const encryptedValue = normalizeString(value, 4096);
  if (!encryptedValue) return '';

  const parts = encryptedValue.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'nc1') {
    throw ApiError.badRequest('Formato de senha criptografada inválido.');
  }

  const [, , ivB64, authTagB64, payloadB64] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getSecretKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(payloadB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function assertAgentNode(tenantId, agentNodeId) {
  if (!agentNodeId || !mongoose.Types.ObjectId.isValid(String(agentNodeId))) {
    throw ApiError.badRequest('Agent local obrigatório para o concentrador.');
  }

  const agentNode = await NetworkNode.findOne({
    _id: agentNodeId,
    tenantId,
    type: 'REMOTE_AGENT',
    isActive: true,
  }).lean();

  if (!agentNode) {
    throw ApiError.badRequest('Agent local não encontrado ou inativo para este tenant.');
  }

  return agentNode;
}

function normalizePayload(data, existing = null) {
  const payload = {};

  if (!existing || data.name !== undefined) {
    payload.name = normalizeString(data.name, 120);
    if (!payload.name) throw ApiError.badRequest('Nome do concentrador é obrigatório.');
  }

  if (!existing || data.type !== undefined) {
    payload.type = normalizeString(data.type, 40) || 'mikrotik';
    assertEnum(payload.type, NETWORK_CONCENTRATOR_TYPES, 'Tipo do concentrador');
  }
  if (!existing || data.agentNodeId !== undefined) payload.agentNodeId = data.agentNodeId;
  if (!existing || data.host !== undefined) {
    payload.host = normalizeString(data.host, 255);
    if (!payload.host) throw ApiError.badRequest('Host do concentrador é obrigatório.');
  }

  if (!existing || data.port !== undefined) {
    const port = Number(data.port || (payload.type === 'mikrotik' ? 8728 : 0));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw ApiError.badRequest('Porta do concentrador inválida.');
    }
    payload.port = port;
  }

  if (!existing || data.username !== undefined) {
    payload.username = normalizeString(data.username, 120);
    if (!payload.username) throw ApiError.badRequest('Usuário do concentrador é obrigatório.');
  }

  if (!existing || data.protocol !== undefined) {
    payload.protocol = normalizeString(data.protocol, 40) || 'routeros';
    assertEnum(payload.protocol, NETWORK_CONCENTRATOR_PROTOCOLS, 'Protocolo do concentrador');
  }

  if (data.password !== undefined || data.secret !== undefined) {
    payload.passwordEncrypted = encryptSecret(data.password ?? data.secret);
  } else if (!existing) {
    throw ApiError.badRequest('Senha do concentrador é obrigatória.');
  }

  if (data.tls !== undefined || !existing) payload.tls = Boolean(data.tls);
  if (data.enabled !== undefined || !existing) payload.enabled = data.enabled !== false;
  if (data.status !== undefined) {
    payload.status = normalizeString(data.status, 40) || 'unknown';
    assertEnum(payload.status, NETWORK_CONCENTRATOR_STATUSES, 'Status do concentrador');
  }
  if (data.lastErrorSafe !== undefined) payload.lastErrorSafe = normalizeString(data.lastErrorSafe, 500);
  if (data.metadata !== undefined || !existing) payload.metadata = safeMetadata(data.metadata || {});

  return payload;
}

function sanitizeNetworkConcentrator(item) {
  if (!item) return null;
  const row = typeof item.toObject === 'function' ? item.toObject() : item;

  return {
    id: String(row._id || row.id),
    tenantId: row.tenantId ? String(row.tenantId) : null,
    name: row.name || '',
    type: row.type || 'other',
    agentNodeId: row.agentNodeId ? String(row.agentNodeId) : null,
    host: row.host || '',
    port: row.port || null,
    username: row.username || '',
    protocol: row.protocol || 'other',
    tls: Boolean(row.tls),
    enabled: row.enabled !== false,
    status: row.status || 'unknown',
    lastTestAt: row.lastTestAt || null,
    lastErrorSafe: row.lastErrorSafe || '',
    metadata: safeMetadata(row.metadata || {}),
    snapshotSummary: row.snapshotSummary
      ? {
          total: Number(row.snapshotSummary.total || 0),
          online: Number(row.snapshotSummary.online || 0),
          offline: Number(row.snapshotSummary.offline || 0),
          lastSyncAt: row.snapshotSummary.lastSyncAt || null,
        }
      : null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

async function createNetworkConcentrator(data, authContext) {
  const tenantId = getTenantId(authContext);
  const payload = normalizePayload(data || {});
  await assertAgentNode(tenantId, payload.agentNodeId);

  const created = await NetworkConcentrator.create({
    ...payload,
    tenantId,
    status: payload.status || 'unknown',
  });

  return sanitizeNetworkConcentrator(created);
}

async function listNetworkConcentrators(authContext) {
  const tenantId = getTenantId(authContext);
  const rows = await NetworkConcentrator.find({ tenantId }).sort({ name: 1 }).lean();
  if (!rows.length) return [];

  const summaries = await PppoeLiveSnapshot.aggregate([
    {
      $match: {
        tenantId: String(tenantId),
        concentratorId: { $in: rows.map((row) => row._id) },
      },
    },
    {
      $group: {
        _id: '$concentratorId',
        total: { $sum: 1 },
        online: { $sum: { $cond: [{ $eq: ['$status', 'online'] }, 1, 0] } },
        offline: { $sum: { $cond: [{ $eq: ['$status', 'offline'] }, 1, 0] } },
        lastSyncAt: { $max: '$lastUpdateAt' },
      },
    },
  ]);
  const summaryById = new Map(summaries.map((item) => [String(item._id), item]));

  return rows.map((row) => sanitizeNetworkConcentrator({
    ...row,
    snapshotSummary: summaryById.get(String(row._id)) || null,
  }));
}

async function updateNetworkConcentrator(id, data, authContext) {
  const tenantId = getTenantId(authContext);
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    throw ApiError.badRequest('Concentrador inválido.');
  }

  const existing = await NetworkConcentrator.findOne({ _id: id, tenantId })
    .select('+passwordEncrypted')
    .lean();
  if (!existing) throw ApiError.notFound('Concentrador não encontrado.');

  const payload = normalizePayload(data || {}, existing);
  if (payload.agentNodeId !== undefined) await assertAgentNode(tenantId, payload.agentNodeId);

  const updated = await NetworkConcentrator.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: payload },
    { new: true, runValidators: true },
  ).lean();

  return sanitizeNetworkConcentrator(updated);
}

async function deleteNetworkConcentrator(id, authContext) {
  const tenantId = getTenantId(authContext);
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    throw ApiError.badRequest('Concentrador inválido.');
  }

  const deleted = await NetworkConcentrator.findOneAndDelete({ _id: id, tenantId }).lean();
  if (!deleted) throw ApiError.notFound('Concentrador não encontrado.');

  return { ok: true };
}

async function testNetworkConcentrator(id, authContext) {
  const tenantId = getTenantId(authContext);
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    throw ApiError.badRequest('Concentrador inválido.');
  }

  const concentrator = await NetworkConcentrator.findOne({ _id: id, tenantId })
    .select('+passwordEncrypted')
    .lean();
  if (!concentrator) throw ApiError.notFound('Concentrador não encontrado.');
  if (!concentrator.enabled) throw ApiError.badRequest('Concentrador desativado.');

  await assertAgentNode(tenantId, concentrator.agentNodeId);

  const out = await remoteAgentCommandService.enqueueGenericCommand({
    tenantId,
    networkNodeId: concentrator.agentNodeId,
    kind: 'NETWORK_CONCENTRATOR_TEST',
    payload: {
      kind: 'NETWORK_CONCENTRATOR_TEST',
      type: 'network_concentrator_test',
      concentratorId: String(concentrator._id),
      action: 'test_connection',
      concentrator: {
        type: concentrator.type,
        protocol: concentrator.protocol,
        tls: Boolean(concentrator.tls),
      },
      routerApi: {
        host: concentrator.host,
        port: Number(concentrator.port) || 8728,
        username: concentrator.username,
        password: decryptSecret(concentrator.passwordEncrypted),
        tls: Boolean(concentrator.tls),
      },
    },
  });

  await NetworkConcentrator.updateOne(
    { _id: concentrator._id, tenantId },
    {
      $set: {
        lastTestAt: new Date(),
        status: 'unknown',
        lastErrorSafe: '',
      },
    },
  );

  return {
    queued: true,
    commandId: out.command?._id ? String(out.command._id) : null,
    concentratorId: String(concentrator._id),
    agentNodeId: String(concentrator.agentNodeId),
  };
}

module.exports = {
  createNetworkConcentrator,
  listNetworkConcentrators,
  updateNetworkConcentrator,
  deleteNetworkConcentrator,
  testNetworkConcentrator,
  sanitizeNetworkConcentrator,
  encryptSecret,
  decryptSecret,
};
