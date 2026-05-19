const mongoose = require('mongoose');
const MikrotikServer = require('../models/MikrotikServer');
const NetworkNode = require('../models/NetworkNode');
const MikrotikSyncJob = require('../models/MikrotikSyncJob');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const OperationLog = require('../models/OperationLog');

const AGENT_ONLINE_MS = 120_000;
const REMOTE_AGENT_PROCESSING_TIMEOUT_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(30_000, Number(process.env.REMOTE_AGENT_PROCESSING_TIMEOUT_MS || 120_000)),
);

exports.getDeepHealth = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const tidStr = tenantId.toString();

    const [
      totalServers,
      activeServers,
      remoteAgents,
      agentsSeenRecently,
      syncPending,
      agentCommandsPending,
      agentCommandsProcessing,
      agentCommandsFailed,
      agentCommandsStale,
      oldestPendingCommand,
      oldestProcessingCommand,
      recentErrors,
    ] = await Promise.all([
      MikrotikServer.countDocuments({ tenantId }),
      MikrotikServer.countDocuments({ tenantId, isActive: true }),
      NetworkNode.countDocuments({ tenantId, type: 'REMOTE_AGENT' }),
      NetworkNode.countDocuments({
        tenantId,
        type: 'REMOTE_AGENT',
        agentLastSeenAt: { $gte: new Date(Date.now() - AGENT_ONLINE_MS) },
      }),
      MikrotikSyncJob.countDocuments({ tenantId, status: 'pending' }),
      RemoteAgentCommand.countDocuments({ tenantId, status: 'pending' }),
      RemoteAgentCommand.countDocuments({ tenantId, status: 'processing' }),
      RemoteAgentCommand.countDocuments({ tenantId, status: 'failed' }),
      RemoteAgentCommand.countDocuments({
        tenantId,
        status: 'processing',
        lockedAt: { $lte: new Date(Date.now() - REMOTE_AGENT_PROCESSING_TIMEOUT_MS) },
      }),
      RemoteAgentCommand.findOne({ tenantId, status: 'pending' })
        .sort({ createdAt: 1 })
        .select('createdAt')
        .lean(),
      RemoteAgentCommand.findOne({ tenantId, status: 'processing' })
        .sort({ lockedAt: 1 })
        .select('lockedAt')
        .lean(),
      OperationLog.find({ tenantId, status: 'error' })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('action targetType targetId errorMessage createdAt')
        .lean(),
    ]);

    res.json({
      status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
      generatedAt: new Date().toISOString(),
      tenantId: tidStr,
      mikrotik: {
        totalServers,
        activeServers,
      },
      agents: {
        remoteAgentNodes: remoteAgents,
        seenRecently: agentsSeenRecently,
        onlineWindowSeconds: AGENT_ONLINE_MS / 1000,
      },
      queues: {
        mikrotikSyncPending: syncPending,
        remoteAgentCommandsPending: agentCommandsPending,
        remoteAgentCommandsProcessing: agentCommandsProcessing,
        remoteAgentCommandsFailed: agentCommandsFailed,
        remoteAgentCommandsStale: agentCommandsStale,
        remoteAgentProcessingTimeoutMs: REMOTE_AGENT_PROCESSING_TIMEOUT_MS,
        oldestPendingCommandAt:
          oldestPendingCommand && oldestPendingCommand.createdAt ? oldestPendingCommand.createdAt.toISOString() : null,
        oldestProcessingCommandLockedAt:
          oldestProcessingCommand && oldestProcessingCommand.lockedAt ? oldestProcessingCommand.lockedAt.toISOString() : null,
      },
      recentErrors: (recentErrors || []).map((r) => ({
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      })),
    });
  } catch (err) {
    next(err);
  }
};
