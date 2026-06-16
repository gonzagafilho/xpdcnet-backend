const mongoose = require('mongoose');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const { emitRealtime } = require('../realtime/socketServer');
const { persistInterfaceDiscovery } = require('./networkInterfaceInventoryService');
const { correlateTopologyFromInterfaces } = require('./networkTopologyCorrelationService');
const { updateTopologyHealthFromInterfaces } = require('./networkTopologyHealthService');
const { saveTelemetrySnapshot } = require('./mikrotikTelemetryService');

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
  const maxInflightPerNode = Math.max(
    1,
    Number(process.env.REMOTE_AGENT_MAX_INFLIGHT_PER_NODE || 1),
  );

  const inflight = await RemoteAgentCommand.countDocuments({
    networkNodeId: nodeId,
    status: 'processing',
  });

  if (inflight >= maxInflightPerNode) {
    return null;
  }


  const cmd = await RemoteAgentCommand.findOneAndUpdate(
    {
      networkNodeId: nodeId,
      status: 'pending',
      $expr: { $lt: ['$attempts', '$maxAttempts'] },
    },
    {
      $set: {
        status: 'processing',
        lockedAt: new Date(),
        resultError: '',
        lastErrorAt: null,
      },
      $inc: { attempts: 1 },
    },
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
  const resultData = body.resultData ?? body.data ?? body.result ?? null;

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
        resultData,
        completedAt: new Date(),
      },
    },
    { new: true },
  ).lean();

  if (!updated) return { error: 'not_found_or_not_processing' };

  if (
    success &&
    updated.kind === 'READ_INTERFACE_DISCOVERY'
  ) {
    try {
      const persisted = await persistInterfaceDiscovery({
        tenantId: updated.tenantId,
        networkNodeId: updated.networkNodeId,
        commandId: updated._id,
        interfaces: Array.isArray(resultData)
          ? resultData
          : [],
      });

      const correlated = await correlateTopologyFromInterfaces({
        tenantId: updated.tenantId,
        networkNodeId: updated.networkNodeId,
      });

      const health = await updateTopologyHealthFromInterfaces({
        tenantId: updated.tenantId,
        networkNodeId: updated.networkNodeId,
      });

      console.log(
        '[interface.discovery.pipeline]',
        JSON.stringify({
          persisted,
          correlated,
          health,
        })
      );
    } catch (pipelineError) {
      console.error(
        '[interface.discovery.pipeline.error]',
        pipelineError
      );
    }
  }



try {
  emitRealtime('noc.event', {
    type: success ? 'command.done' : 'command.failed',
    severity: success ? 'success' : 'warning',
    title: success
      ? 'Comando remoto concluído'
      : 'Comando remoto falhou',

    message: success
      ? `${updated.kind || 'COMMAND'} concluído`
      : `${updated.kind || 'COMMAND'} falhou: ${
          resultError || resultMessage || 'erro desconhecido'
        }`,

    commandId: String(updated._id),
    networkNodeId: String(updated.networkNodeId),
    tenantId: String(updated.tenantId),

    kind: updated.kind,
    status: updated.status,

    resultAction: updated.resultAction,
    resultMessage: updated.resultMessage,
    resultError: updated.resultError,

    completedAt: updated.completedAt,
  });

  emitRealtime('command:update', {
    commandId: String(updated._id),
    networkNodeId: String(updated.networkNodeId),
    tenantId: String(updated.tenantId),

    kind: updated.kind,
    status: updated.status,

    success,
  });
  if (
  success &&
  (
    updated.kind === 'READ_RESOURCE' ||
    updated.kind === 'SERVER_SNAPSHOT' ||
    updated.kind === 'SERVER_SNAPSHOT_DETAIL' ||
    updated.kind === 'READ_PPP_ACTIVE'
  )
) {
  const rawData = updated.resultData || resultData || null;

  const unwrap = (value) => {
    if (!value) return null;

    if (Array.isArray(value)) {
      return unwrap(value[0]);
    }

    if (typeof value === 'string') {
      try {
        return unwrap(JSON.parse(value));
      } catch (_) {
        return null;
      }
    }

    if (typeof value === 'object') {
      if (value.raw) return unwrap(value.raw);
      if (value.data) return unwrap(value.data);
      if (value.resultData) return unwrap(value.resultData);
      return value;
    }

    return null;
  };

  const telemetry = unwrap(rawData);

  const resource = Array.isArray(telemetry?.resource)
  ? telemetry.resource[0]
  : telemetry?.resource || (
      telemetry &&
      typeof telemetry === 'object' &&
      telemetry['cpu-load'] != null
        ? telemetry
        : null
    );

  const identity = Array.isArray(telemetry?.identity)
    ? telemetry.identity[0]
    : telemetry?.identity || null;

  const cpuLoad =
    resource && resource['cpu-load'] != null
      ? Number(resource['cpu-load'])
      : null;


    const pppEnvCount = Array.isArray(rawData)
      ? rawData.find((item) => item?.name === 'xpdcnetPppActiveCount')
      : null;

    const pppEnvAt = Array.isArray(rawData)
      ? rawData.find((item) => item?.name === 'xpdcnetPppActiveAt')
      : null;

    const pppOnline =
      telemetry?.pppActiveTotal != null
        ? Number(telemetry.pppActiveTotal)
        : telemetry?.pppActive?.total != null
          ? Number(telemetry.pppActive.total)
          : pppEnvCount?.value != null
            ? Number(pppEnvCount.value)
            : null;

    const freeMemory =
      resource && resource['free-memory'] != null
        ? Number(resource['free-memory'])
        : null;

    const totalMemory =
      resource && resource['total-memory'] != null
        ? Number(resource['total-memory'])
        : null;

    const version =
      resource && resource.version != null
        ? String(resource.version)
        : null;

    const uptime =
      resource && resource.uptime != null
        ? String(resource.uptime)
        : null;

  const interfaces = Array.isArray(telemetry?.interfaces)
    ? telemetry.interfaces
    : [];

  const routerName =
    identity?.name ||
    telemetry?.identity?.name ||
    telemetry?.name ||
    'RouterOS';

  console.log('[TELEMETRY_METRIC_EMIT]', JSON.stringify({
    kind: updated.kind,
    cpuLoad,
    freeMemory,
    totalMemory,
    pppOnline,
    pppCollectedAt: pppEnvAt?.value || telemetry?.pppActive?.collectedAt || null,
    version,
    uptime,
    interfaceCount: interfaces.length,
  }));

     emitRealtime('telemetry.metric', {
      type: 'telemetry.metric',
      severity: 'info',

      title: 'Telemetria RouterOS',

      message:
        `${routerName}: CPU ${cpuLoad ?? '—'}% | ` +
        `PPP ${pppOnline ?? '—'} | ` +
        `Interfaces ${interfaces.length}`,

      commandId: String(updated._id),
      networkNodeId: String(updated.networkNodeId),
      tenantId: String(updated.tenantId),

      routerName,
      cpuLoad,
      pppOnline,
      freeMemory,
      totalMemory,
      version,
      uptime,
      interfaceCount: interfaces.length,
      
      completedAt: updated.completedAt,
    });

    saveTelemetrySnapshot({
      serverId: updated.serverId || updated.networkNodeId,
      serverName: routerName,
      cpuPercent: cpuLoad || 0,
      memoryPercent:
        totalMemory && freeMemory
          ? Math.max(0, Math.min(100, Number((((totalMemory - freeMemory) / totalMemory) * 100).toFixed(2))))
          : 0,
      pppOnline: pppOnline || 0,
      interfaces,
      metadata: {
        kind: updated.kind,
        commandId: String(updated._id),
        tenantId: String(updated.tenantId),
        networkNodeId: String(updated.networkNodeId),
        pppCollectedAt: pppEnvAt?.value || telemetry?.pppActive?.collectedAt || null,
        version,
        uptime,
      },
    }).then((snap) => {
      console.log('[TELEMETRY_SNAPSHOT_SAVED]', JSON.stringify({
        id: String(snap._id),
        serverId: String(snap.serverId),
        pppOnline: snap.pppOnline,
        kind: snap.metadata?.kind,
      }));
    }).catch((err) => {
      console.error('[TELEMETRY_SNAPSHOT_SAVE_ERROR]', err && err.message ? err.message : err);
    });
  if (cpuLoad !== null && cpuLoad >= 85) {
    emitRealtime('telemetry.alert', {
      type: 'telemetry.alert',
      severity: 'warning',

      title: 'CPU elevada no RouterOS',

      message: `${routerName}: CPU ${cpuLoad}%`,

      commandId: String(updated._id),
      networkNodeId: String(updated.networkNodeId),
      tenantId: String(updated.tenantId),

      routerName,
      cpuLoad,

      completedAt: updated.completedAt,
    });
  }
}
} catch (err) {
  console.error(
    '[REMOTE_AGENT_COMMAND_REALTIME] falha ao emitir evento:',
    err && err.message ? err.message : err
  );
}

return { command: updated };
};

/**
 * Recupera comandos presos em processing após timeout.
 * - Se ainda tem tentativas disponíveis: volta para pending.
 * - Se estourou maxAttempts: marca como failed.
 */
exports.recoverStaleProcessingCommands = async (opts = {}) => {
  const timeoutMs = Math.min(
    24 * 60 * 60 * 1000,
    Math.max(30_000, Number(opts.timeoutMs || process.env.REMOTE_AGENT_PROCESSING_TIMEOUT_MS || 120_000)),
  );

  const now = new Date();
  const staleBefore = new Date(Date.now() - timeoutMs);

  const stale = await RemoteAgentCommand.find({
    status: 'processing',
    lockedAt: { $lte: staleBefore },
  })
    .sort({ lockedAt: 1 })
    .limit(Math.min(500, Math.max(1, Number(opts.limit || 100))))
    .lean();

  let requeued = 0;
  let failed = 0;

  for (const cmd of stale) {
    const attempts = Number(cmd.attempts || 0);
    const maxAttempts = Math.max(1, Number(cmd.maxAttempts || 3));
    const canRetry = attempts < maxAttempts;

    if (canRetry) {
      const r = await RemoteAgentCommand.updateOne(
        { _id: cmd._id, status: 'processing' },
        {
          $set: {
            status: 'pending',
            resultSuccess: null,
            resultAction: 'requeue_stale_processing',
            resultMessage: 'Comando retornou para pending por timeout em processing.',
            resultError: 'PROCESSING_TIMEOUT_REQUEUED',
            lastErrorAt: now,
          },
          $unset: {
            lockedAt: '',
          },
        },
      );
      if (r.modifiedCount > 0) requeued += 1;
    } else {
      const r = await RemoteAgentCommand.updateOne(
        { _id: cmd._id, status: 'processing' },
        {
          $set: {
            status: 'failed',
            resultSuccess: false,
            resultAction: 'deadletter_stale_processing',
            resultMessage: 'Comando falhou após exceder tentativas por timeout em processing.',
            resultError: 'PROCESSING_TIMEOUT_MAX_ATTEMPTS',
            lastErrorAt: now,
            completedAt: now,
          },
        },
      );
      if (r.modifiedCount > 0) failed += 1;
    }
  }

  return {
    ok: true,
    timeoutMs,
    checked: stale.length,
    requeued,
    failed,
  };
};


/**
 * Comando remoto administrativo genérico.
 */
exports.enqueueGenericCommand = async (params) => {
  const {
    tenantId,
    networkNodeId,
    serverId,
    kind,
    payload,
  } = params;

  const command = await RemoteAgentCommand.create({
    tenantId,
    networkNodeId,
    clientId: null,
    serverId: serverId || null,
    mikrotikSyncJobId: null,
    kind,
    status: 'pending',
    payload: payload || {},
  });

  return { command: command.toObject() };
};

/**
 * Lista comandos de um node.
 */
exports.listCommandsForNode = async (tenantId, networkNodeId, limit = 50) => {
  return RemoteAgentCommand.find({
    tenantId,
    networkNodeId,
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit || 50))))
    .lean();
};
