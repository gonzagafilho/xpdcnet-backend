const mongoose = require('mongoose');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');

/**
 * @param {object} params
 */
exports.enqueueSyncIntentCommand = async (params) => {
  const {
    tenantId,
    networkNodeId,
    clientId,
    serverId,
    mikrotikSyncJobId,
    payload,
  } = params;

  if (!clientId || !mongoose.Types.ObjectId.isValid(String(clientId))) {
    throw new Error('enqueueSyncIntentCommand: clientId obrigatório');
  }

  if (mikrotikSyncJobId && mongoose.Types.ObjectId.isValid(String(mikrotikSyncJobId))) {
    const existing = await RemoteAgentCommand.findOne({
      tenantId,
      networkNodeId,
      mikrotikSyncJobId,
      status: { $in: ['pending', 'processing'] },
    }).lean();
    if (existing) {
      return { command: existing, duplicate: true };
    }
  }

  const command = await RemoteAgentCommand.create({
    tenantId,
    networkNodeId,
    clientId,
    serverId: serverId || null,
    mikrotikSyncJobId: mikrotikSyncJobId || null,
    kind: 'SYNC_INTENT',
    status: 'pending',
    payload,
  });

  return { command: command.toObject(), duplicate: false };
};

/**
 * Leitura PPPoE remota (LAN da filial) — sem MikroTikSyncJob.
 */
exports.enqueueMonitoringInspectCommand = async (params) => {
  const { tenantId, networkNodeId, clientId, serverId, payload } = params;

  if (!clientId || !mongoose.Types.ObjectId.isValid(String(clientId))) {
    throw new Error('enqueueMonitoringInspectCommand: clientId obrigatório');
  }

  const command = await RemoteAgentCommand.create({
    tenantId,
    networkNodeId,
    clientId,
    serverId: serverId || null,
    mikrotikSyncJobId: null,
    kind: 'MONITORING_INSPECT',
    status: 'pending',
    payload,
  });

  return { command: command.toObject() };
};

/**
 * Snapshot operacional do equipamento (lista ou detalhe NOC) via agente remoto — sem Client.
 * @param {{ tenantId: any, networkNodeId: any, serverId: any, kind: 'SERVER_SNAPSHOT'|'SERVER_SNAPSHOT_DETAIL', payload: object }} params
 */
exports.enqueueServerMonitoringCommand = async (params) => {
  const { tenantId, networkNodeId, serverId, kind, payload } = params;
  if (kind !== 'SERVER_SNAPSHOT' && kind !== 'SERVER_SNAPSHOT_DETAIL') {
    throw new Error('enqueueServerMonitoringCommand: kind inválido');
  }
  if (!serverId || !mongoose.Types.ObjectId.isValid(String(serverId))) {
    throw new Error('enqueueServerMonitoringCommand: serverId obrigatório');
  }

  const command = await RemoteAgentCommand.create({
    tenantId,
    networkNodeId,
    clientId: null,
    serverId,
    mikrotikSyncJobId: null,
    kind,
    status: 'pending',
    payload,
  });

  return { command: command.toObject() };
};

/**
 * @param {string} nodeId
 */
exports.claimNextPendingForNode = async (nodeId) => {
  if (!mongoose.Types.ObjectId.isValid(String(nodeId))) return null;

  const cmd = await RemoteAgentCommand.findOneAndUpdate(
    { networkNodeId: nodeId, status: 'pending' },
    { $set: { status: 'processing', lockedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true },
  ).lean();

  return cmd;
};

/**
 * @param {string} nodeId
 */
exports.completeCommandForNode = async (nodeId, commandId, body) => {
  if (!mongoose.Types.ObjectId.isValid(String(commandId))) return { error: 'invalid_id' };

  const success = body.success !== false;
  const resultAction = body.action != null ? String(body.action).slice(0, 32) : null;
  const resultMessage = body.message != null ? String(body.message).slice(0, 4000) : '';
  const resultError = body.error != null ? String(body.error).slice(0, 2000) : '';

  const updated = await RemoteAgentCommand.findOneAndUpdate(
    {
      _id: commandId,
      networkNodeId: nodeId,
      status: 'processing',
    },
    {
      $set: {
        status: success ? 'done' : 'failed',
        resultSuccess: success,
        resultAction,
        resultMessage,
        resultError: success ? '' : resultError,
        completedAt: new Date(),
      },
    },
    { new: true },
  ).lean();

  if (!updated) return { error: 'not_found_or_not_processing' };
  return { command: updated };
};
