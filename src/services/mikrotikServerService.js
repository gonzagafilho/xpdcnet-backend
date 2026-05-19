const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const MikrotikServer = require('../models/MikrotikServer');
const NetworkNode = require('../models/NetworkNode');
const { encrypt, isEncrypted } = require('./encryptionService');

async function assertNetworkNodeIfPresent(tenantId, networkNodeId) {
  if (networkNodeId === undefined || networkNodeId === null || networkNodeId === '') return;
  if (!mongoose.Types.ObjectId.isValid(String(networkNodeId))) {
    throw ApiError.badRequest('networkNodeId inválido');
  }
  const n = await NetworkNode.findOne({ _id: networkNodeId, tenantId }).lean();
  if (!n) throw ApiError.badRequest('networkNodeId não encontrado neste tenant');
}

function assertExecutionFields(data) {
  const mode = data.executionMode != null ? String(data.executionMode) : 'auto';
  if (!['auto', 'direct', 'agent'].includes(mode)) {
    throw ApiError.badRequest('executionMode inválido (use auto, direct ou agent).');
  }
}

async function assertAgentRemoteNode(tenantId, nodeOid) {
  const n = await NetworkNode.findOne({ _id: nodeOid, tenantId }).lean();
  if (!n) throw ApiError.badRequest('Node de execução não encontrado neste tenant.');
  if (n.type !== 'REMOTE_AGENT') {
    throw ApiError.badRequest('executionMode=agent exige um NetworkNode do tipo REMOTE_AGENT.');
  }
}

/**
 * Valida vínculo de agente quando o modo final do registo é `agent`.
 * @param {string} mode
 * @param {string|null|undefined} agentId
 * @param {string|null|undefined} networkNodeId
 */
async function assertAgentModeIfNeeded(tenantId, mode, agentId, networkNodeId) {
  if (String(mode) !== 'agent') return;
  const a = agentId != null && String(agentId).trim() && mongoose.Types.ObjectId.isValid(String(agentId));
  const nn =
    networkNodeId != null &&
    String(networkNodeId).trim() &&
    mongoose.Types.ObjectId.isValid(String(networkNodeId));
  if (!a && !nn) {
    throw ApiError.badRequest('executionMode=agent requer agentId ou networkNodeId de um agente remoto.');
  }
  const chosen = a ? agentId : networkNodeId;
  await assertAgentRemoteNode(tenantId, chosen);
}

exports.createServer = async (tenantId, data) => {
  const { name, host, port, username, password, isActive, networkNodeId, executionMode, agentId } = data;
  assertExecutionFields({ executionMode: executionMode || 'auto' });

  if (!name || !String(name).trim()) {
    throw ApiError.badRequest('name é obrigatório');
  }
  if (!host || !String(host).trim()) {
    throw ApiError.badRequest('host é obrigatório');
  }

  const p = port !== undefined && port !== null ? Number(port) : 8728;
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    throw ApiError.badRequest('port deve ser um número entre 1 e 65535');
  }

  let encryptedPassword = '';
  try {
    encryptedPassword = encrypt(password != null ? String(password) : '');
  } catch (err) {
    if (err && err.code === 'SYSTEM_NOT_CONFIGURED') {
      throw ApiError.serviceUnavailable('Sistema precisa ser configurado.', 'SYSTEM_NOT_CONFIGURED');
    }
    if (err && err.code === 'MISSING_MIKROTIK_SECRET_KEY') {
      throw ApiError.serviceUnavailable('Sistema precisa ser configurado.', 'SYSTEM_NOT_CONFIGURED');
    }
    throw ApiError.serviceUnavailable(
      'Não foi possível proteger a credencial MikroTik.',
      'SERVER_MISCONFIGURED',
    );
  }

  await assertNetworkNodeIfPresent(tenantId, networkNodeId);
  if (agentId != null && agentId !== '') {
    await assertNetworkNodeIfPresent(tenantId, agentId);
  }

  const effMode = executionMode != null ? String(executionMode) : 'auto';
  await assertAgentModeIfNeeded(tenantId, effMode, agentId, networkNodeId);

  const server = await MikrotikServer.create({
    tenantId,
    networkNodeId:
      networkNodeId != null && mongoose.Types.ObjectId.isValid(String(networkNodeId))
        ? networkNodeId
        : null,
    executionMode: executionMode != null ? String(executionMode) : 'auto',
    agentId:
      agentId != null && mongoose.Types.ObjectId.isValid(String(agentId)) ? agentId : null,
    name: String(name).trim(),
    host: String(host).trim(),
    port: p,
    username: username != null ? String(username) : '',
    password: encryptedPassword,
    isActive: isActive === undefined ? true : Boolean(isActive),
  });

  return server;
};

exports.listServers = async (tenantId) => {
  return MikrotikServer.find({ tenantId }).sort({ createdAt: -1 });
};

/** Usado por GET /:id e como auxiliar interno. */
exports.getServer = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const server = await MikrotikServer.findOne({ _id: id, tenantId });
  if (!server) throw ApiError.notFound('Servidor MikroTik não encontrado');

  return server;
};

exports.updateServer = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const previous = await MikrotikServer.findOne({ _id: id, tenantId }).lean();

  const $set = {};
  if (data.name !== undefined) {
    if (!String(data.name).trim()) throw ApiError.badRequest('name não pode ser vazio');
    $set.name = String(data.name).trim();
  }
  if (data.host !== undefined) {
    if (!String(data.host).trim()) throw ApiError.badRequest('host não pode ser vazio');
    $set.host = String(data.host).trim();
  }
  if (data.port !== undefined) {
    const p = Number(data.port);
    if (!Number.isFinite(p) || p < 1 || p > 65535) {
      throw ApiError.badRequest('port deve ser um número entre 1 e 65535');
    }
    $set.port = p;
  }
  if (data.username !== undefined) $set.username = String(data.username);
  if (data.password !== undefined) {
    const raw = String(data.password);
    if (isEncrypted(raw)) {
      $set.password = raw;
    } else {
      try {
        $set.password = encrypt(raw);
      } catch (err) {
        if (err && err.code === 'SYSTEM_NOT_CONFIGURED') {
          throw ApiError.serviceUnavailable('Sistema precisa ser configurado.', 'SYSTEM_NOT_CONFIGURED');
        }
        if (err && err.code === 'MISSING_MIKROTIK_SECRET_KEY') {
          throw ApiError.serviceUnavailable('Sistema precisa ser configurado.', 'SYSTEM_NOT_CONFIGURED');
        }
        throw ApiError.serviceUnavailable(
          'Não foi possível proteger a credencial MikroTik.',
          'SERVER_MISCONFIGURED',
        );
      }
    }
  }
  if (data.isActive !== undefined) $set.isActive = Boolean(data.isActive);
  if (data.networkNodeId !== undefined) {
    if (data.networkNodeId === null || data.networkNodeId === '') {
      $set.networkNodeId = null;
    } else {
      await assertNetworkNodeIfPresent(tenantId, data.networkNodeId);
      $set.networkNodeId = data.networkNodeId;
    }
  }
  if (data.executionMode !== undefined) {
    assertExecutionFields({ executionMode: data.executionMode });
    $set.executionMode = String(data.executionMode);
  }
  if (data.agentId !== undefined) {
    if (data.agentId === null || data.agentId === '') {
      $set.agentId = null;
    } else {
      await assertNetworkNodeIfPresent(tenantId, data.agentId);
      $set.agentId = data.agentId;
    }
  }

  const mergedMode =
    $set.executionMode !== undefined
      ? String($set.executionMode)
      : previous && previous.executionMode != null
        ? String(previous.executionMode)
        : 'auto';
  const mergedAgent =
    $set.agentId !== undefined
      ? $set.agentId
      : previous && previous.agentId != null
        ? previous.agentId
        : null;
  const mergedNetworkNodeId =
    $set.networkNodeId !== undefined
      ? $set.networkNodeId
      : previous && previous.networkNodeId != null
        ? previous.networkNodeId
        : null;
  await assertAgentModeIfNeeded(tenantId, mergedMode, mergedAgent, mergedNetworkNodeId);

  if (Object.keys($set).length === 0) {
    return exports.getServer(tenantId, id);
  }

  const updated = await MikrotikServer.findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true });
  if (!updated) throw ApiError.notFound('Servidor MikroTik não encontrado');

  return updated;
};

exports.deleteServer = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const deleted = await MikrotikServer.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('Servidor MikroTik não encontrado');

  return true;
};
