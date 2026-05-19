const NetworkNode = require('../models/NetworkNode');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const OperationLog = require('../models/OperationLog');

const AGENT_ONLINE_MS = 120_000;
const REMOTE_AGENT_PROCESSING_TIMEOUT_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(30_000, Number(process.env.REMOTE_AGENT_PROCESSING_TIMEOUT_MS || 120_000)),
);

const ApiError = require('../errors/ApiError');
const monitoringSessionBoardService = require('../services/monitoringSessionBoardService');
const monitoringClientPanelService = require('../services/monitoringClientPanelService');

/** GET /monitoring/client/:id */
exports.getClientMonitoring = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const row = await monitoringClientPanelService.getClientMonitoringSummary(tenantId, req.params.id, req.query || {});
    if (!row) throw ApiError.notFound('Cliente não encontrado');
    res.json(row);
  } catch (err) {
    next(err);
  }
};

/** GET /monitoring/session-board */
exports.getSessionBoard = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await monitoringSessionBoardService.getSessionBoard(tenantId, req.query || {});
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

/** GET /monitoring/queue-health */
exports.getQueueHealth = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id;
    const now = Date.now();
    const staleBefore = new Date(now - REMOTE_AGENT_PROCESSING_TIMEOUT_MS);
    const onlineSince = new Date(now - AGENT_ONLINE_MS);

    const [
      pending,
      processing,
      failed,
      stale,
      oldestPending,
      oldestProcessing,
      agentsTotal,
      agentsOnline,
      recentRecoveries,
      recentErrors,
    ] = await Promise.all([
      RemoteAgentCommand.countDocuments({ tenantId, status: 'pending' }),
      RemoteAgentCommand.countDocuments({ tenantId, status: 'processing' }),
      RemoteAgentCommand.countDocuments({ tenantId, status: 'failed' }),
      RemoteAgentCommand.countDocuments({ tenantId, status: 'processing', lockedAt: { $lte: staleBefore } }),
      RemoteAgentCommand.findOne({ tenantId, status: 'pending' }).sort({ createdAt: 1 }).select('createdAt kind networkNodeId attempts maxAttempts').lean(),
      RemoteAgentCommand.findOne({ tenantId, status: 'processing' }).sort({ lockedAt: 1 }).select('lockedAt kind networkNodeId attempts maxAttempts').lean(),
      NetworkNode.countDocuments({ tenantId, type: 'REMOTE_AGENT' }),
      NetworkNode.countDocuments({ tenantId, type: 'REMOTE_AGENT', agentLastSeenAt: { $gte: onlineSince } }),
      OperationLog.countDocuments({
        tenantId,
        action: { $in: ['remote_agent.command.requeued', 'remote_agent.command.deadletter'] },
        createdAt: { $gte: new Date(now - 60 * 60 * 1000) },
      }),
      OperationLog.find({ tenantId, status: 'error' })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('action targetType targetId errorMessage createdAt')
        .lean(),
    ]);

    const degraded = stale > 0 || failed > 0 || (agentsTotal > 0 && agentsOnline === 0);

    res.json({
      status: degraded ? 'degraded' : 'ok',
      generatedAt: new Date().toISOString(),
      timeWindowSeconds: 3600,
      agents: {
        total: agentsTotal,
        online: agentsOnline,
        offline: Math.max(0, agentsTotal - agentsOnline),
        onlineWindowSeconds: AGENT_ONLINE_MS / 1000,
      },
      queue: {
        pending,
        processing,
        failed,
        stale,
        processingTimeoutMs: REMOTE_AGENT_PROCESSING_TIMEOUT_MS,
        oldestPendingCommandAt:
          oldestPending && oldestPending.createdAt ? oldestPending.createdAt.toISOString() : null,
        oldestProcessingLockedAt:
          oldestProcessing && oldestProcessing.lockedAt ? oldestProcessing.lockedAt.toISOString() : null,
        oldestPending,
        oldestProcessing,
      },
      recovery: {
        recentRecoveriesLastHour: recentRecoveries,
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

/** GET /monitoring/stream */
exports.streamQueueHealth = async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (res.flushHeaders) {
      res.flushHeaders();
    }

    const tenantId = req.tenant._id;

    const sendSnapshot = async () => {
      try {
        const now = Date.now();

        const staleBefore = new Date(
          now - REMOTE_AGENT_PROCESSING_TIMEOUT_MS
        );

        const onlineSince = new Date(
          now - AGENT_ONLINE_MS
        );

        const [
          pending,
          processing,
          failed,
          stale,
          agentsTotal,
          agentsOnline,
          recentRecoveries,
        ] = await Promise.all([
          RemoteAgentCommand.countDocuments({
            tenantId,
            status: 'pending',
          }),

          RemoteAgentCommand.countDocuments({
            tenantId,
            status: 'processing',
          }),

          RemoteAgentCommand.countDocuments({
            tenantId,
            status: 'failed',
          }),

          RemoteAgentCommand.countDocuments({
            tenantId,
            status: 'processing',
            lockedAt: { $lte: staleBefore },
          }),

          NetworkNode.countDocuments({
            tenantId,
            type: 'REMOTE_AGENT',
          }),

          NetworkNode.countDocuments({
            tenantId,
            type: 'REMOTE_AGENT',
            agentLastSeenAt: { $gte: onlineSince },
          }),

          OperationLog.countDocuments({
            tenantId,
            action: {
              $in: [
                'remote_agent.command.requeued',
                'remote_agent.command.deadletter',
              ],
            },
            createdAt: {
              $gte: new Date(now - 60 * 60 * 1000),
            },
          }),
        ]);

        const degraded =
          stale > 0 ||
          failed > 0 ||
          (agentsTotal > 0 && agentsOnline === 0);

        const payload = {
          generatedAt: new Date().toISOString(),

          status: degraded ? 'degraded' : 'ok',

          agents: {
            total: agentsTotal,
            online: agentsOnline,
            offline: Math.max(0, agentsTotal - agentsOnline),
          },

          queue: {
            pending,
            processing,
            failed,
            stale,
          },

          recovery: {
            recentRecoveriesLastHour: recentRecoveries,
          },
        };

        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: err.message,
          })}\n\n`
        );
      }
    };

    await sendSnapshot();

    const interval = setInterval(sendSnapshot, 5000);

    req.on('close', () => {
      clearInterval(interval);
    });

  } catch (err) {
    next(err);
  }
};
