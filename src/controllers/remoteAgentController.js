const Client = require('../models/Client');
const networkNodeService = require('../services/networkNodeService');
const remoteAgentCommandService = require('../services/remoteAgentCommandService');
const { syncAgentPppoeSnapshots } = require('../services/pppoeSnapshotService');
const operationLogService = require('../services/operationLogService');
const { emitRealtime } = require('../realtime/socketServer');

const FORBIDDEN_PPPOE_SNAPSHOT_KEYS = new Set([
  'password',
  'senha',
  'secret',
  'routerApi',
  'credentials',
  'credential',
  'config',
  'snmp',
  'api',
  'host',
  'mikrotikHost',
  'mikrotikPassword',
  'tenantId',
]);

function containsForbiddenSnapshotKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenSnapshotKey);
  return Object.keys(value).some((key) => {
    const normalized = String(key).toLowerCase();
    const forbidden = FORBIDDEN_PPPOE_SNAPSHOT_KEYS.has(normalized)
      || normalized.includes('password')
      || normalized.includes('senha')
      || normalized.includes('secret')
      || normalized.includes('credential')
      || normalized.includes('routerapi')
      || normalized.includes('snmp')
      || normalized.includes('host')
      || normalized === 'config';
    return forbidden || containsForbiddenSnapshotKey(value[key]);
  });
}

function isAgentTenantFallbackAllowed() {
  const mode = String(process.env.NODE_ENV || process.env.SYSTEM_MODE || '').toLowerCase();
  return ['test', 'lab', 'development'].includes(mode) || String(process.env.PPPOE_AGENT_TENANT_FALLBACK_ENABLED || '').toLowerCase() === 'true';
}

function resolveAgentTenantId(node) {
  const tenantId = node?.tenantId != null ? String(node.tenantId).trim() : '';
  if (tenantId) return tenantId;
  if (isAgentTenantFallbackAllowed()) {
    const fallback = String(process.env.PPPOE_DEFAULT_TENANT_ID || '').trim();
    if (fallback) return fallback;
  }
  return '';
}

function normalizeAgentPppoeSnapshotPayload(body = {}) {
  const sessions = Array.isArray(body.sessions) ? body.sessions : [body];
  return sessions.map((item) => ({
    username: item?.username,
    currentIp: item?.currentIp,
    uptime: item?.uptime,
    service: item?.service,
    callerId: item?.callerId,
    downloadBytes: item?.downloadBytes,
    uploadBytes: item?.uploadBytes,
  }));
}

exports.heartbeat = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const meta = req.body && typeof req.body === 'object' ? req.body : null;
    await networkNodeService.touchAgentHeartbeat(node._id, meta);
    res.json({ ok: true, nodeId: String(node._id) });
  } catch (err) {
    next(err);
  }
};

exports.nextCommand = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const cmd = await remoteAgentCommandService.claimNextPendingForNode(node._id);
    if (!cmd) {
      res.status(204).send();
      return;
    }
    res.json(cmd);
  } catch (err) {
    next(err);
  }
};

exports.completeCommand = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const commandId = req.params.id;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const r = await remoteAgentCommandService.completeCommandForNode(node._id, commandId, body);
    if (r.error === 'invalid_id') {
      res.status(400).json({ error: r.error });
      return;
    }
    if (r.error) {
      res.status(404).json({ error: r.error });
      return;
    }

    const cmd = r.command;
    if (cmd && cmd.clientId && cmd.kind !== 'MONITORING_INSPECT') {
      const now = new Date();
      const success = body.success !== false;
      const errMsg = body.error != null ? String(body.error).slice(0, 2000) : '';
      await Client.updateOne(
        { _id: cmd.clientId, tenantId: cmd.tenantId },
        {
          $set: {
            'mikrotik.sync.state': success ? 'in_sync' : 'error',
            'mikrotik.sync.lastAttemptAt': now,
            ...(success
              ? { 'mikrotik.sync.lastSuccessAt': now, 'mikrotik.sync.lastErrorMessage': '' }
              : { 'mikrotik.sync.lastErrorMessage': errMsg || 'Agente remoto reportou falha.' }),
          },
        },
      );
    }

    if (cmd) {
      const success = body.success !== false;
      await operationLogService.logOperation({
        tenantId: cmd.tenantId,
        userId: null,
        action: 'remote_agent.command.complete',
        targetType: 'RemoteAgentCommand',
        targetId: String(cmd._id),
        payload: { kind: cmd.kind, networkNodeId: String(node._id) },
        result: { success, action: body.action, message: body.message },
        status: success ? 'success' : 'error',
        errorMessage: success ? '' : String(body.error || ''),
        req,
      });
    }

    res.json({ ok: true, command: cmd });
  } catch (err) {
    next(err);
  }
};

exports.receivePppoeSnapshots = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (containsForbiddenSnapshotKey(body)) {
      res.status(400).json({ error: 'forbidden_snapshot_field' });
      return;
    }

    const tenantId = resolveAgentTenantId(node);
    if (!tenantId) {
      res.status(400).json({ error: 'agent_tenant_id_missing' });
      return;
    }

    const sessions = normalizeAgentPppoeSnapshotPayload(body);
    const result = await syncAgentPppoeSnapshots(sessions, tenantId);
    await networkNodeService.touchAgentHeartbeat(node._id, {
      pppoeSnapshotAt: result.syncedAt,
      pppoeOnline: result.online,
      pppoeOfflineMarked: result.offlineMarked,
    });

    res.json({
      ok: true,
      online: result.online,
      offlineMarked: result.offlineMarked,
      totalRead: result.totalRead,
      syncedAt: result.syncedAt,
    });
  } catch (err) {
    next(err);
  }
};
