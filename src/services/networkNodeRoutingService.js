const mongoose = require('mongoose');
const NetworkNode = require('../models/NetworkNode');

const AGENT_HEARTBEAT_STALE_MS = Math.max(
  30_000,
  Number.parseInt(String(process.env.AGENT_HEARTBEAT_STALE_MS || '120000'), 10) || 120_000,
);

function isAgentHeartbeatStale(node) {
  if (!node || !node.agentLastSeenAt) return true;
  const t = new Date(node.agentLastSeenAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > AGENT_HEARTBEAT_STALE_MS;
}

/**
 * Resolve o canal de execução RouterOS para um par cliente + equipamento cadastrado.
 * Sem node explícito → LOCAL_DIRECT (compatível com instalações existentes).
 *
 * @param {string|mongoose.Types.ObjectId} tenantId
 * @param {object} clientPlain — cliente plain (deve expor networkNodeId opcional)
 * @param {object} serverDoc — MikrotikServer lean
 * @returns {Promise<{ channel: 'LOCAL_DIRECT'|'REMOTE_AGENT', networkNode: object|null } | { channel: 'ERROR', code: string, message: string }>}
 */
exports.resolveExecutionRoute = async (tenantId, clientPlain, serverDoc) => {
  const tid = String(tenantId);
  const mode = serverDoc && serverDoc.executionMode ? String(serverDoc.executionMode) : 'auto';

  if (mode === 'direct') {
    return { channel: 'LOCAL_DIRECT', networkNode: null };
  }

  if (mode === 'agent') {
    const agentRef =
      serverDoc && serverDoc.agentId != null
        ? String(serverDoc.agentId)
        : serverDoc && serverDoc.networkNodeId != null
          ? String(serverDoc.networkNodeId)
          : '';
    if (!agentRef || !mongoose.Types.ObjectId.isValid(agentRef)) {
      return {
        channel: 'ERROR',
        code: 'AGENT_REQUIRED',
        message: 'executionMode=agent requer agentId ou networkNodeId de um agente remoto.',
      };
    }
    const agentNode = await NetworkNode.findOne({ _id: agentRef, tenantId: tid }).lean();
    if (!agentNode || agentNode.type !== 'REMOTE_AGENT') {
      return {
        channel: 'ERROR',
        code: 'AGENT_INVALID',
        message: 'Agente remoto inválido: o node deve ser do tipo REMOTE_AGENT.',
      };
    }
    if (!agentNode.isActive) {
      return {
        channel: 'ERROR',
        code: 'AGENT_INACTIVE',
        message: `Agente remoto «${agentNode.name}» está inactivo.`,
      };
    }
    if (isAgentHeartbeatStale(agentNode)) {
      return {
        channel: 'ERROR',
        code: 'AGENT_OFFLINE',
        message: `Agente «${agentNode.name}» sem heartbeat recente — indisponível para execução remota.`,
      };
    }
    return { channel: 'REMOTE_AGENT', networkNode: agentNode };
  }

  const fromClient = clientPlain && clientPlain.networkNodeId != null ? String(clientPlain.networkNodeId) : '';
  const fromServer = serverDoc && serverDoc.networkNodeId != null ? String(serverDoc.networkNodeId) : '';
  const chosen = fromClient || fromServer || '';

  if (!chosen || !mongoose.Types.ObjectId.isValid(chosen)) {
    return { channel: 'LOCAL_DIRECT', networkNode: null };
  }

  const node = await NetworkNode.findOne({ _id: chosen, tenantId: tid }).lean();
  if (!node) {
    return {
      channel: 'ERROR',
      code: 'NETWORK_NODE_NOT_FOUND',
      message: 'NetworkNode referenciado não existe para este tenant.',
    };
  }
  if (!node.isActive) {
    return {
      channel: 'ERROR',
      code: 'NETWORK_NODE_INACTIVE',
      message: `NetworkNode «${node.name}» está inactivo.`,
    };
  }

  if (node.type === 'REMOTE_AGENT' || node.connectionMode === 'REMOTE_AGENT_OUTBOUND') {
    if (isAgentHeartbeatStale(node)) {
      return {
        channel: 'ERROR',
        code: 'AGENT_OFFLINE',
        message: `Agente «${node.name}» sem heartbeat recente — indisponível para execução remota.`,
      };
    }
    return { channel: 'REMOTE_AGENT', networkNode: node };
  }

  return { channel: 'LOCAL_DIRECT', networkNode: node };
};
