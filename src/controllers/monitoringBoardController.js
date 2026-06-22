const NetworkNode = require('../models/NetworkNode');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const OperationLog = require('../models/OperationLog');
const MikrotikTelemetrySnapshot = require('../models/MikrotikTelemetrySnapshot');
const MikrotikServerSnapshot = require('../models/MikrotikServerSnapshot');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Invoice = require('../models/Invoice');
const NetworkTopologyTrafficSnapshot = require('../models/NetworkTopologyTrafficSnapshot');
const NetworkTopologySnapshot = require('../models/NetworkTopologySnapshot');
const NetworkTopologyLink = require('../models/NetworkTopologyLink');

const AGENT_ONLINE_MS = 120_000;
const REMOTE_AGENT_PROCESSING_TIMEOUT_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(30_000, Number(process.env.REMOTE_AGENT_PROCESSING_TIMEOUT_MS || 120_000)),
);

const ApiError = require('../errors/ApiError');
const monitoringSessionBoardService = require('../services/monitoringSessionBoardService');
const monitoringClientPanelService = require('../services/monitoringClientPanelService');
const { getWorkerTelemetry } = require('../services/workerTelemetryService');
const { saveNocSnapshot, listRecentNocSnapshots } = require('../services/nocSnapshotService');
const { evaluateNocIncidents, listOpenIncidents, listRecentIncidents } = require('../services/nocIncidentService');
const { generateSlaSnapshot, getLatestSlaSnapshot } = require('../services/nocSlaService');

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
    const queueRecentSince = new Date(now - 24 * 60 * 60 * 1000);
    const [
      pending,
      processing,
      failed,
      failedTotal,
      stale,
      oldestPending,
      oldestProcessing,
      agentsTotal,
      agentsOnline,
      recentRecoveries,
      recentErrors,
      workers,
      latestTelemetry,
      latestServerSnapshot,
      activeClients,
      blockedClients,
      delinquentClients,
      suspendedClients,
      cancelledClients,
      activePlans,
      mrrResult,
      invoiceRevenueResult,
      invoiceCountResult,
      newClientsThisMonth,
      cancelledClientsThisMonth,
      topTrafficLinks,
      latestTopologySnapshot,
      topologyLinks,

      ] = await Promise.all([
              RemoteAgentCommand.countDocuments({
          tenantId,
          status: 'pending',
          updatedAt: { $gte: queueRecentSince },
        }),
        RemoteAgentCommand.countDocuments({ tenantId, status: 'processing' }),
                  RemoteAgentCommand.countDocuments({
            tenantId,
            status: 'failed',
            kind: { $ne: 'SERVER_SNAPSHOT' },
            updatedAt: { $gte: queueRecentSince },
        }),
          RemoteAgentCommand.countDocuments({
            tenantId,
            status: 'failed',
            kind: { $ne: 'SERVER_SNAPSHOT' },
          }),
          RemoteAgentCommand.countDocuments({ tenantId, status: 'processing', lockedAt: { $lte: staleBefore } }),
                RemoteAgentCommand.findOne({
          tenantId,
          status: 'pending',
          updatedAt: { $gte: queueRecentSince },
        })
          .sort({ createdAt: 1 })
          .select('createdAt kind networkNodeId attempts maxAttempts')
          .lean(),

        RemoteAgentCommand.findOne({ tenantId, status: 'processing' })
          .sort({ lockedAt: 1 })
          .select('lockedAt kind networkNodeId attempts maxAttempts')
          .lean(),
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
      getWorkerTelemetry(),
      MikrotikTelemetrySnapshot.findOne({
        $or: [
          { tenantId },
          { 'metadata.tenantId': String(tenantId) },
        ],
      })
        .sort({ createdAt: -1 })
        .lean(),
      MikrotikServerSnapshot.findOne({ tenantId })
        .sort({ generatedAt: -1, createdAt: -1 })
        .lean(),
        Client.countDocuments({
          tenantId,
          status: 'active',
        }),

        Client.countDocuments({
          tenantId,
          status: 'blocked',
        }),

        Client.countDocuments({
          tenantId,
          status: 'delinquent',
        }),

        Client.countDocuments({
           tenantId,
           status: 'suspended',
        }),

        Client.countDocuments({
          tenantId,
          status: 'cancelled',
        }),

        Plan.countDocuments({
          tenantId,
          isActive: true,
        }),

        Client.aggregate([
          {
            $match: {
            tenantId,
            status: 'active',
           },
          },
            {
              $group: {
              _id: null,
              total: { $sum: '$monthlyPrice' },
           },
          },
        ]),
        Invoice.aggregate([
         {
            $match: {
             tenantId,
          },
         },
         {
            $group: {
              _id: '$status',
              total: { $sum: '$amount' },
           },
         },
        ]),

        Invoice.aggregate([
           {
              $match: {
              tenantId,
          }, 
         },
           {
              $group: {
               _id: '$status',
               count: { $sum: 1 },
            },
         },
        ]),

         Client.countDocuments({
            tenantId,
            createdAt: {
               $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
         }),

          Client.countDocuments({
             tenantId,
             status: 'cancelled',
             updatedAt: {
             $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
         }),
           NetworkTopologyTrafficSnapshot.find({ tenantId })
            .sort({ sampledAt: -1, totalMbps: -1 })
            .limit(20)
            .lean(),
          NetworkTopologySnapshot.findOne({ tenantId })
            .sort({ sampledAt: -1, createdAt: -1 })
            .lean(),
          NetworkTopologyLink.find({ tenantId, isActive: true })
            .select('status healthLevel healthScore capacityMbps currentRxMbps currentTxMbps')
            .lean(),
   ]);

    const degraded = stale > 0 || (agentsTotal > 0 && agentsOnline === 0);
    const mrr =
      Array.isArray(mrrResult) && mrrResult.length > 0
      ? Number(mrrResult[0].total || 0)
      : 0;

    const averageTicket =
      activeClients > 0
      ? Number((mrr / activeClients).toFixed(2))
      : 0;

      const revenueByStatus = Object.fromEntries(
        (invoiceRevenueResult || []).map((row) => [row._id, Number(row.total || 0)])
      );

      const invoiceCountByStatus = Object.fromEntries(
        (invoiceCountResult || []).map((row) => [row._id, Number(row.count || 0)])
      );

      const expectedRevenue =
        Number(revenueByStatus.pending || 0) +
        Number(revenueByStatus.paid || 0) +
        Number(revenueByStatus.overdue || 0);

      const receivedRevenue = Number(revenueByStatus.paid || 0);
      const overdueRevenue = Number(revenueByStatus.overdue || 0);

      const pendingInvoices = Number(invoiceCountByStatus.pending || 0);
      const paidInvoices = Number(invoiceCountByStatus.paid || 0);
      const overdueInvoices = Number(invoiceCountByStatus.overdue || 0);
      const pppSecretCount =
        latestServerSnapshot?.pppSecretCount != null
          ? Number(latestServerSnapshot.pppSecretCount)
          : 0;

      const pppActiveTotal =
        latestServerSnapshot?.activePppTotal != null
          ? Number(latestServerSnapshot.activePppTotal)
          : Number(latestTelemetry?.pppOnline || 0);

      const offlineClients = Math.max(0, pppSecretCount - pppActiveTotal);

      const connectivityRate =
        pppSecretCount > 0
          ? Number(((pppActiveTotal / pppSecretCount) * 100).toFixed(2))
          : 0;
      const latestTrafficByLink = new Map();

for (const row of topTrafficLinks || []) {
  const key = String(row.linkId || row.linkCode || row.linkName || '');
  if (!key || latestTrafficByLink.has(key)) continue;
  latestTrafficByLink.set(key, row);
}

const trafficRows = Array.from(latestTrafficByLink.values())
  .sort((a, b) => Number(b.totalMbps || 0) - Number(a.totalMbps || 0));

const topLinks = trafficRows.slice(0, 5).map((row) => ({
  linkId: row.linkId ? String(row.linkId) : null,
  linkCode: row.linkCode || '',
  linkName: row.linkName || '',
  rxMbps: Number(row.rxMbps || 0),
  txMbps: Number(row.txMbps || 0),
  totalMbps: Number(row.totalMbps || 0),
  utilizationPct: Number(row.utilizationPct || 0),
  status: row.status || 'unknown',
  healthLevel: row.healthLevel || 'healthy',
  isAlerted: Boolean(row.isAlerted),
  alertType: row.alertType || null,
  sampledAt: row.sampledAt || row.createdAt || null,
}));

const mostUtilizedLink =
  trafficRows.length > 0
    ? topLinks
        .slice()
        .sort((a, b) => Number(b.utilizationPct || 0) - Number(a.utilizationPct || 0))[0] || null
    : null;

const alertedLinks = trafficRows
  .filter((row) => Boolean(row.isAlerted))
  .slice(0, 10)
  .map((row) => ({
    linkId: row.linkId ? String(row.linkId) : null,
    linkCode: row.linkCode || '',
    linkName: row.linkName || '',
    totalMbps: Number(row.totalMbps || 0),
    utilizationPct: Number(row.utilizationPct || 0),
    healthLevel: row.healthLevel || 'healthy',
    alertType: row.alertType || null,
  }));

  const topologyLinkRows = Array.isArray(topologyLinks) ? topologyLinks : [];

const averageUtilization =
  trafficRows.length > 0
    ? Number(
        (
          trafficRows.reduce((acc, row) => acc + Number(row.utilizationPct || 0), 0) /
          trafficRows.length
        ).toFixed(2),
      )
    : 0;
      const capacityTotalMbps = topologyLinkRows.reduce(
          (acc, link) => acc + Number(link.capacityMbps || 0),
          0,
        );

      const trafficCurrentMbps = trafficRows.reduce(
        (acc, row) => acc + Number(row.totalMbps || 0),
        0,
      );

      const saturatedLinks = trafficRows.filter(
        (row) => Number(row.utilizationPct || 0) >= 80,
      ).length;

      const realTotalLinks = topologyLinkRows.length;
      const realOnlineLinks = topologyLinkRows.filter((link) => link.status === 'online').length;
      const realDegradedLinks = topologyLinkRows.filter((link) => link.status === 'degraded').length;
      const realOfflineLinks = topologyLinkRows.filter((link) => link.status === 'offline').length;

      const realHealthScores = topologyLinkRows.map((link) => Number(link.healthScore || 100));

      const realAvgHealthScore =
        realHealthScores.length > 0
          ? Math.round(realHealthScores.reduce((acc, value) => acc + value, 0) / realHealthScores.length)
          : Number(latestTopologySnapshot?.avgHealthScore ?? 100);

      const realTopologyHealthLevel =
        realAvgHealthScore <= 0
          ? 'offline'
          : realAvgHealthScore <= 49
            ? 'critical'
            : realAvgHealthScore <= 79
            ? 'warning'
            : 'healthy';
    const payload = {
      status: degraded ? 'degraded' : 'ok',
      generatedAt: new Date().toISOString(),
      timeWindowSeconds: 3600,
      queueWindowHours: 24,
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
          failedRecent: failed,
          failedTotal,
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
      workers,
      commercial: {
        activeClients,
        blockedClients,
        delinquentClients,
        suspendedClients,
        cancelledClients,
        mrr,
        averageTicket,
        activePlans,
        expectedRevenue,
        receivedRevenue,
        overdueRevenue,
        pendingInvoices,
        paidInvoices,
        overdueInvoices,
        newClientsThisMonth,
        cancelledClientsThisMonth,
      },
      mikrotik: {
        pppOnline: latestTelemetry?.pppOnline ?? 0,
        pppCollectedAt:
          latestTelemetry?.metadata?.pppCollectedAt ?? null,
        lastTelemetryAt:
          latestTelemetry?.createdAt
            ? latestTelemetry.createdAt.toISOString()
            : null,
        serverId:
          latestTelemetry?.serverId
            ? String(latestTelemetry.serverId)
            : null,
        serverName:
        latestTelemetry?.serverName || null,
        pppSecretCount,
        pppActiveTotal,
        offlineClients,
        connectivityRate,
        cpuPercent: latestTelemetry?.cpuPercent ?? null,
        memoryPercent: latestTelemetry?.memoryPercent ?? null,
        memoryFreeBytes: latestTelemetry?.memoryFreeBytes ?? null,
        memoryTotalBytes: latestTelemetry?.memoryTotalBytes ?? null,
        temperature: latestTelemetry?.temperature ?? null,
        voltage: latestTelemetry?.voltage ?? null,
        interfaceCount: latestTelemetry?.interfaceTotal ?? (Array.isArray(latestTelemetry?.interfaces) ? latestTelemetry.interfaces.length : null),
        interfaceRunning: latestTelemetry?.interfaceRunning ?? null,
        version: latestTelemetry?.version || latestTelemetry?.metadata?.version || null,
        uptime: latestTelemetry?.uptime || latestTelemetry?.metadata?.uptime || null,
        boardName: latestTelemetry?.boardName || null,
        cpuCount: latestTelemetry?.cpuCount ?? null,
        architectureName: latestTelemetry?.architectureName || null,
       },
        network: {
          totalLinks: realTotalLinks,
          onlineLinks: realOnlineLinks,
          degradedLinks: realDegradedLinks,
          offlineLinks: realOfflineLinks,
          avgHealthScore: realAvgHealthScore,
          topologyHealthLevel: realTopologyHealthLevel,
          averageUtilization,

          capacityTotalMbps,
          trafficCurrentMbps,
          saturatedLinks,

          mostUtilizedLink,
          alertedLinks,
          topLinks,
        },
      recentErrors: (recentErrors || []).map((r) => ({
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      })),
    };

    saveNocSnapshot(payload).catch((err) => {
      console.error('[NOC] erro ao salvar snapshot:', err && err.message ? err.message : err);
    });

    evaluateNocIncidents(payload).catch((err) => {
      console.error('[NOC] erro ao avaliar incidentes:', err && err.message ? err.message : err);
    });

    res.json(payload);
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

        const queueRecentSince = new Date(
          now - 24 * 60 * 60 * 1000
       );

        const [
          pending,
          processing,
          failed,
          failedTotal,
          stale,
          agentsTotal,
          agentsOnline,
          recentRecoveries,
          workers,
          
          latestTelemetry,
          latestServerSnapshot,
        ] = await Promise.all([
                      RemoteAgentCommand.countDocuments({
              tenantId,
              status: 'pending',
              updatedAt: { $gte: queueRecentSince },
            }),

            RemoteAgentCommand.countDocuments({
              tenantId,
              status: 'processing',
            }),

            RemoteAgentCommand.countDocuments({
              tenantId,
              status: 'failed',
              kind: { $ne: 'SERVER_SNAPSHOT' },
              updatedAt: { $gte: queueRecentSince },
            }),
              RemoteAgentCommand.countDocuments({
                tenantId,
                status: 'failed',
                kind: { $ne: 'SERVER_SNAPSHOT' }
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
          getWorkerTelemetry(),
          MikrotikTelemetrySnapshot.findOne({
        $or: [
          { tenantId },
          { 'metadata.tenantId': String(tenantId) },
        ],
      })
            .sort({ createdAt: -1 })
            .lean(),
           MikrotikServerSnapshot.findOne({ tenantId })
            .sort({ generatedAt: -1, createdAt: -1 })
            .lean(),
        ]);

        const degraded =
          stale > 0 ||
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
              failedRecent: failed,
              failedTotal,
              stale,
            },

          recovery: {
            recentRecoveriesLastHour: recentRecoveries,
          },
          workers,
          commercial: {
            activeClients,
            blockedClients,
            delinquentClients,
            suspendedClients,
            cancelledClients,
            mrr,
            averageTicket,
            activePlans,
           },
          mikrotik: {
            pppOnline: latestTelemetry?.pppOnline ?? 0,
            pppCollectedAt:
              latestTelemetry?.metadata?.pppCollectedAt ?? null,
            lastTelemetryAt:
              latestTelemetry?.createdAt
                ? latestTelemetry.createdAt.toISOString()
                : null,
            serverId:
              latestTelemetry?.serverId
                ? String(latestTelemetry.serverId)
                : null,
                          serverName:
                latestTelemetry?.serverName || null,
              pppSecretCount:
                latestServerSnapshot?.pppSecretCount ?? null,
              pppActiveTotal:
                latestServerSnapshot?.activePppTotal ?? null,
              cpuPercent: latestTelemetry?.cpuPercent ?? null,
            memoryPercent: latestTelemetry?.memoryPercent ?? null,
            memoryFreeBytes: latestTelemetry?.memoryFreeBytes ?? null,
            memoryTotalBytes: latestTelemetry?.memoryTotalBytes ?? null,
            temperature: latestTelemetry?.temperature ?? null,
            voltage: latestTelemetry?.voltage ?? null,
            interfaceCount: latestTelemetry?.interfaceTotal ?? (Array.isArray(latestTelemetry?.interfaces) ? latestTelemetry.interfaces.length : null),
            interfaceRunning: latestTelemetry?.interfaceRunning ?? null,
            version: latestTelemetry?.version || latestTelemetry?.metadata?.version || null,
            uptime: latestTelemetry?.uptime || latestTelemetry?.metadata?.uptime || null,
            boardName: latestTelemetry?.boardName || null,
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


/** GET /monitoring/noc-history */
exports.getNocHistory = async (req, res, next) => {
  try {
    const limit = Math.min(
      500,
      Math.max(10, Number(req.query.limit || 60)),
    );

    const rows = await listRecentNocSnapshots(limit);

    res.json({
      ok: true,
      total: rows.length,
      rows: rows.reverse().map((row) => ({
        createdAt: row.createdAt,

        pending: row.pending || 0,
        processing: row.processing || 0,
        failed: row.failed || 0,
        stale: row.stale || 0,

        pressurePercent: row.pressurePercent || 0,
        throughputPerMinute: row.throughputPerMinute || 0,

        agents: row.agents || {},
        workers: row.workers || {},
      })),
    });
  } catch (err) {
    next(err);
  }
};


/** GET /monitoring/noc-incidents */
exports.getNocIncidents = async (req, res, next) => {
  try {
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit || 30)),
    );

    const status = String(req.query.status || 'open');

    const rows =
      status === 'all'
        ? await listRecentIncidents(limit)
        : await listOpenIncidents(limit);

    res.json({
      ok: true,
      total: rows.length,
      rows,
    });
  } catch (err) {
    next(err);
  }
};


/** GET /monitoring/noc-sla */
exports.getNocSla = async (req, res, next) => {
  try {
    let row = await getLatestSlaSnapshot();

    if (!row) {
      row = await generateSlaSnapshot();
    }

    res.json({
      ok: true,
      sla: row,
    });
  } catch (err) {
    next(err);
  }
};
