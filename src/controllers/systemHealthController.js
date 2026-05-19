const mongoose = require('mongoose');
const MikrotikServer = require('../models/MikrotikServer');
const NetworkNode = require('../models/NetworkNode');
const MikrotikSyncJob = require('../models/MikrotikSyncJob');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const OperationLog = require('../models/OperationLog');

const AGENT_ONLINE_MS = 120_000;

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
