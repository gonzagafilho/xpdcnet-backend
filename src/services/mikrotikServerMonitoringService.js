const mongoose = require('mongoose');
const MikrotikServer = require('../models/MikrotikServer');
const MikrotikServerSnapshot = require('../models/MikrotikServerSnapshot');
const NetworkNode = require('../models/NetworkNode');
const Client = require('../models/Client');
const MikrotikSyncJob = require('../models/MikrotikSyncJob');
const { decrypt } = require('./encryptionService');
const { withMikrotikConnection, scrubSecretsFromMessage } = require('../integrations/mikrotik/mikrotikClient');
const ApiError = require('../errors/ApiError');
const {
  fetchOperationalSnapshot,
  fetchOperationalSnapshotDetail,
} = require('../integrations/mikrotik/mikrotikExecutor');
const networkNodeRoutingService = require('./networkNodeRoutingService');
const remoteAgentCommandService = require('./remoteAgentCommandService');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const { saveTelemetrySnapshot } = require('./mikrotikTelemetryService');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Aguarda resultado JSON de comando remoto (snapshot servidor ou inspect PPP). */
async function waitRemoteAgentJsonResult(commandId, timeoutMs) {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 5_000), 120_000);
  while (Date.now() < deadline) {
    const doc = await RemoteAgentCommand.findById(commandId).lean();
    if (!doc) return { err: 'REMOTE_COMMAND_LOST' };
    if (doc.status === 'done' && doc.resultSuccess) {
      if (doc.resultData && typeof doc.resultData === 'object') {
        return { json: doc.resultData };
      }

      try {
        return { json: JSON.parse(doc.resultMessage || '{}') };
      } catch (_) {
        return { err: 'REMOTE_JSON_PARSE' };
      }
    }
    if (doc.status === 'failed') {
      const err =
        doc.resultError && String(doc.resultError).trim()
          ? String(doc.resultError).trim()
          : doc.resultMessage && String(doc.resultMessage).trim()
            ? String(doc.resultMessage).trim()
            : 'REMOTE_AGENT_FAILED';
      return { err };
    }
    await sleep(300);
  }
  return { err: 'REMOTE_AGENT_TIMEOUT' };
}

function parseBigIntish(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace(/\s/g, '');
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

function parseCpuLoad(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace('%', '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function pickStr(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function buildBoardLabel(routerboard, resource) {
  const fromRb = pickStr(routerboard, 'board-name', 'boardName', 'model', 'model-name', 'modelName');
  const fromRes = pickStr(resource, 'board-name', 'boardName');
  const fw = pickStr(routerboard, 'current-firmware', 'currentFirmware');
  const base = fromRb || fromRes;
  if (base && fw) return `${base} · ${fw}`;
  return base || fw || null;
}

function normalizeSnapshot(raw) {
  
  const identityObj = Array.isArray(raw?.identity) ? raw.identity[0] : raw?.identity;
  const resourceObj = Array.isArray(raw?.resource) ? raw.resource[0] : raw?.resource;
  const routerboardObj = Array.isArray(raw?.routerboard) ? raw.routerboard[0] : raw?.routerboard;
  const healthObj = Array.isArray(raw?.health) ? raw.health[0] : raw?.health;
  const { interfaces, pppSecretCount, pppActiveTotal } = raw || {};

  const version = pickStr(resourceObj, 'version');
  const identityName = pickStr(identityObj, 'name');
  const uptime = pickStr(resourceObj, 'uptime');
  const cpuPercent = parseCpuLoad(
   resourceObj && (resourceObj['cpu-load'] != null ? resourceObj['cpu-load'] : resourceObj.cpuLoad),
  );
  const memFree = parseBigIntish(resourceObj && (resourceObj['free-memory'] ?? resourceObj.freeMemory));
  const memTotal = parseBigIntish(resourceObj && (resourceObj['total-memory'] ?? resourceObj.totalMemory));
  const diskFree = parseBigIntish(resourceObj && (resourceObj['free-hdd-space'] ?? resourceObj.freeHddSpace));
  const diskTotal = parseBigIntish(resourceObj && (resourceObj['total-hdd-space'] ?? resourceObj.totalHddSpace));
  const temperature = parseBigIntish(healthObj && (healthObj.temperature ?? healthObj['cpu-temperature']));
  const voltage = parseBigIntish(healthObj && healthObj.voltage);
  const cpuCount = parseBigIntish(resourceObj && (resourceObj['cpu-count'] ?? resourceObj.cpuCount));
  const architectureName = pickStr(resourceObj, 'architecture-name', 'architectureName');

  return {
    identityName,
    version,
    board: buildBoardLabel(routerboardObj, resourceObj),
    uptime,
    cpuPercent,
    memoryFreeBytes: memFree,
    memoryTotalBytes: memTotal,
    diskFreeBytes: diskFree,
    diskTotalBytes: diskTotal,
    interfaces: Array.isArray(interfaces) ? interfaces : [],
    interfaceTotal: Array.isArray(interfaces) ? interfaces.length : 0,
    interfaceRunning: Array.isArray(interfaces) ? interfaces.filter((item) => item.running && !item.disabled).length : 0,
    temperature,
    voltage,
    cpuCount,
    architectureName,
    pppSecretCount,
    pppActiveTotal: pppActiveTotal != null && Number.isFinite(Number(pppActiveTotal)) ? Number(pppActiveTotal) : null,
  };
}

/**
 * Normaliza recurso + identidade e preserva interfaces já mapeadas (detalhe NOC).
 */
function normalizeSnapshotDetail(raw) {
  const { interfaces, pppActive, ...rest } = raw || {};
  const base = normalizeSnapshot({ ...rest, interfaces: [] });
  const pa = pppActive && typeof pppActive === 'object' ? pppActive : { items: [], total: 0, truncated: false };
  return {
    ...base,
    interfaces: Array.isArray(interfaces) ? interfaces : [],
    activePppSessions: Array.isArray(pa.items) ? pa.items : [],
    activePppSessionsTotal: Number.isFinite(Number(pa.total)) ? Number(pa.total) : (pa.items || []).length,
    activePppSessionsTruncated: Boolean(pa.truncated),
  };
}

function parseCounterLocal(s) {
  if (s == null || s === '') return 0;
  const n = Number(String(s).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Nomes de porta alinhados entre snapshot resumido e detalhe (trim; match no painel pode usar toLowerCase). */
function trimInterfaceList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((i) => ({
    ...i,
    name: i && i.name != null ? String(i.name).trim() : '',
  }));
}

function bitsToMbps(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number / 1_000_000 : 0;
}

async function persistTelemetrySnapshot(tenantId, serverId, base) {
  const interfaces = Array.isArray(base.interfaces) ? base.interfaces : [];
  const memoryPercent = base.memoryTotalBytes && base.memoryFreeBytes != null
    ? Math.max(0, Math.min(100, 100 - ((base.memoryFreeBytes / base.memoryTotalBytes) * 100)))
    : 0;

  await saveTelemetrySnapshot({
    tenantId,
    serverId,
    serverName: base.name || '',
    cpuPercent: base.cpuPercent ?? 0,
    memoryPercent: Number(memoryPercent.toFixed(2)),
    memoryFreeBytes: base.memoryFreeBytes ?? null,
    memoryTotalBytes: base.memoryTotalBytes ?? null,
    temperature: base.temperature ?? null,
    voltage: base.voltage ?? null,
    version: base.version || '',
    uptime: base.uptime || '',
    boardName: base.board || '',
    cpuCount: base.cpuCount ?? null,
    architectureName: base.architectureName || '',
    interfaceTotal: interfaces.length,
    interfaceRunning: interfaces.filter((item) => item.running && !item.disabled).length,
    pppOnline: base.activePppSessionsTotal ?? 0,
    interfaces: interfaces.map((item) => ({
      name: item.name || '',
      rxMbps: bitsToMbps(item.rxBitsPerSecond ?? item.rxRate),
      txMbps: bitsToMbps(item.txBitsPerSecond ?? item.txRate),
      running: Boolean(item.running),
      disabled: Boolean(item.disabled),
    })),
    metadata: {
      monitoringChannel: base.monitoringChannel || '',
      online: Boolean(base.online),
      collectedAt: base.lastPolledAt || new Date().toISOString(),
    },
  });
}

/**
 * Alertas operacionais derivados do snapshot actual (sem motor externo).
 */
function computeOperationalAlerts(payload) {
  const alerts = [];
  if (!payload.online) {
    alerts.push({
      level: 'critical',
      code: 'SERVER_OFFLINE',
      title: 'Equipamento indisponível',
      message: payload.lastError || 'Sem ligação RouterOS nesta consulta.',
    });
    return alerts;
  }

  if (payload.lastError && String(payload.lastError).trim()) {
    alerts.push({
      level: 'warning',
      code: 'COMMS_NOTE',
      title: 'Aviso de comunicação',
      message: String(payload.lastError).slice(0, 280),
    });
  }

  if (payload.cpuPercent != null && payload.cpuPercent >= 85) {
    alerts.push({
      level: 'warning',
      code: 'CPU_HIGH',
      title: 'CPU elevada',
      message: `Carga de CPU em ${Math.round(payload.cpuPercent)}%.`,
    });
  }

  if (
    payload.memoryTotalBytes != null &&
    payload.memoryTotalBytes > 0 &&
    payload.memoryFreeBytes != null
  ) {
    const usedPct = 100 - (payload.memoryFreeBytes / payload.memoryTotalBytes) * 100;
    if (usedPct >= 85) {
      alerts.push({
        level: 'critical',
        code: 'MEMORY_CRITICAL',
        title: 'Memória crítica',
        message: `Uso de memória ≈ ${Math.round(usedPct)}%.`,
      });
    }
  }

  if (payload.diskTotalBytes != null && payload.diskTotalBytes > 0 && payload.diskFreeBytes != null) {
    const usedPct = 100 - (payload.diskFreeBytes / payload.diskTotalBytes) * 100;
    if (usedPct >= 90) {
      alerts.push({
        level: 'critical',
        code: 'DISK_CRITICAL',
        title: 'Armazenamento crítico',
        message: `Uso de disco ≈ ${Math.round(usedPct)}%.`,
      });
    }
  }

  if (Array.isArray(payload.interfaces) && payload.interfaces.length > 0) {
    const running = payload.interfaces.filter((i) => i.running && !i.disabled).length;
    if (running === 0) {
      alerts.push({
        level: 'warning',
        code: 'NO_RUNNING_INTERFACES',
        title: 'Sem interfaces em execução',
        message: 'Nenhuma interface marcada como running nesta leitura.',
      });
    }
  } else {
    alerts.push({
      level: 'warning',
      code: 'NO_INTERFACE_DATA',
      title: 'Sem dados de interfaces',
      message: 'A consulta não devolveu interfaces.',
    });
  }

  const activeTotal = payload.activePppSessionsTotal ?? 0;
  const secrets = payload.pppSecretCount ?? 0;
  if (secrets > 0 && activeTotal === 0) {
    alerts.push({
      level: 'info',
      code: 'NO_ACTIVE_PPP',
      title: 'Sem sessões PPP activas',
      message: 'Há secrets PPPoE no equipamento, mas nenhuma sessão activa neste momento.',
    });
  }

  return alerts;
}

function applyOperationalAlertFields(base) {
  const alerts = computeOperationalAlerts(base);
  base.alerts = alerts;
  base.alertsCount = alerts.length;
  base.criticalAlertsCount = alerts.filter((a) => a.level === 'critical').length;
  base.warningAlertsCount = alerts.filter((a) => a.level === 'warning').length;
  base.infoAlertsCount = alerts.filter((a) => a.level === 'info').length;
}

async function attachLinkedClientsToPppSessions(tenantId, serverIdStr, sessions) {
  const tid = mongoose.Types.ObjectId.isValid(tenantId) ? new mongoose.Types.ObjectId(tenantId) : null;
  const list = Array.isArray(sessions) ? sessions : [];
  if (!tid || !list.length) {
    return list.map((s) => ({ ...s, linkedClient: null }));
  }
  const names = [
    ...new Set(
      list
        .map((row) => (row.name != null ? String(row.name).trim() : ''))
        .filter(Boolean),
    ),
  ];
  if (!names.length) {
    return list.map((s) => ({ ...s, linkedClient: null }));
  }

  const clients = await Client.find({
    tenantId: tid,
    'access.username': { $in: names },
  })
    .select('_id fullName access.username mikrotik.serverId')
    .lean();

  const byUsername = new Map();
  for (const c of clients) {
    const u = c.access && c.access.username != null ? String(c.access.username).trim() : '';
    if (u) byUsername.set(u, c);
  }

  return list.map((row) => {
    const u = row.name != null ? String(row.name).trim() : '';
    const c = u ? byUsername.get(u) : null;
    if (!c) {
      return { ...row, linkedClient: null };
    }
    const srv = c.mikrotik && c.mikrotik.serverId != null ? String(c.mikrotik.serverId) : '';
    return {
      ...row,
      linkedClient: {
        clientId: String(c._id),
        fullName: c.fullName || '',
        matchesThisServer: Boolean(srv && srv === String(serverIdStr)),
      },
    };
  });
}

async function persistServerSnapshot(tenantId, serverOid, base) {
  const ifList = Array.isArray(base.interfaces) ? base.interfaces : [];

  const pickRx = (i) =>
    i && i.rxBytes != null ? i.rxBytes
      : i && i.rx != null ? i.rx
      : i && i['rx-byte'] != null ? i['rx-byte']
      : '';

  const pickTx = (i) =>
    i && i.txBytes != null ? i.txBytes
      : i && i.tx != null ? i.tx
      : i && i['tx-byte'] != null ? i['tx-byte']
      : '';

  const topIf = ifList
    .map((i) => ({
      name: i.name || '',
      rx: pickRx(i),
      tx: pickTx(i),
    }))
    .sort((a, b) => parseCounterLocal(b.rx) + parseCounterLocal(b.tx) - (parseCounterLocal(a.rx) + parseCounterLocal(a.tx)))
    .slice(0, 5);

  const interfaceTraffic = ifList.slice(0, 24).map((i) => ({
    name: i.name != null ? String(i.name).trim() : '',
    rxBytes: pickRx(i) != null ? String(pickRx(i)) : '',
    txBytes: pickTx(i) != null ? String(pickTx(i)) : '',
  }));

  await MikrotikServerSnapshot.create({
    tenantId,
    serverId: serverOid,
    online: Boolean(base.online),
    cpuPercent: base.cpuPercent != null ? base.cpuPercent : null,
    memoryTotalBytes: base.memoryTotalBytes != null ? base.memoryTotalBytes : null,
    memoryFreeBytes: base.memoryFreeBytes != null ? base.memoryFreeBytes : null,
    diskTotalBytes: base.diskTotalBytes != null ? base.diskTotalBytes : null,
    diskFreeBytes: base.diskFreeBytes != null ? base.diskFreeBytes : null,
    totalClients: base.totalClients != null ? base.totalClients : 0,
    pppSecretCount: base.pppSecretCount != null ? base.pppSecretCount : null,
    interfaceCount: ifList.length,
    activePppTotal: base.activePppSessionsTotal != null ? base.activePppSessionsTotal : 0,
    lastError: base.lastError ? String(base.lastError).slice(0, 2000) : '',
    topInterfaces: topIf,
    interfaceTraffic,
    generatedAt: new Date(),
  });

  const keep = 10;
  const ids = await MikrotikServerSnapshot.find({ tenantId, serverId: serverOid })
    .sort({ generatedAt: -1 })
    .select('_id')
    .lean();
  if (ids.length > keep) {
    const drop = ids.slice(keep).map((d) => d._id);
    await MikrotikServerSnapshot.deleteMany({ _id: { $in: drop } });
  }
}

async function loadRecentSnapshots(tenantId, serverOid, limit) {
  const lim = Math.min(20, Math.max(1, limit || 10));
  const rows = await MikrotikServerSnapshot.find({ tenantId, serverId: serverOid })
    .sort({ generatedAt: -1 })
    .limit(lim)
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    generatedAt: r.generatedAt.toISOString(),
    online: r.online,
    cpuPercent: r.cpuPercent,
    memoryTotalBytes: r.memoryTotalBytes,
    memoryFreeBytes: r.memoryFreeBytes,
    diskTotalBytes: r.diskTotalBytes,
    diskFreeBytes: r.diskFreeBytes,
    interfaceCount: r.interfaceCount,
    activePppTotal: r.activePppTotal,
    lastError: r.lastError && String(r.lastError).trim() ? String(r.lastError) : null,
    topInterfaces: Array.isArray(r.topInterfaces) ? r.topInterfaces : [],
    interfaceTraffic: Array.isArray(r.interfaceTraffic) ? r.interfaceTraffic : [],
  }));
}

async function finalizeDetailResponse(tenantId, serverOid, base) {
  base.activePppSessions = Array.isArray(base.activePppSessions) ? base.activePppSessions : [];
  base.activePppSessionsTotal =
    base.activePppSessionsTotal != null ? base.activePppSessionsTotal : base.activePppSessions.length;
  base.activePppSessionsTruncated = Boolean(base.activePppSessionsTruncated);
  base.activePppSessions = await attachLinkedClientsToPppSessions(tenantId, String(serverOid), base.activePppSessions);
  base.alerts = computeOperationalAlerts(base);
  base.recentSnapshots = [];
  try {
    await persistServerSnapshot(tenantId, serverOid, base);
    base.recentSnapshots = await loadRecentSnapshots(tenantId, serverOid, 10);
  } catch (err) {
    console.error('[mikrotikServerMonitoring] snapshot:', err && err.message ? err.message : err);
  }
  return base;
}

async function clientCountsByServer(tenantId) {
  const tid = mongoose.Types.ObjectId.isValid(tenantId) ? new mongoose.Types.ObjectId(tenantId) : null;
  if (!tid) return new Map();
  const rows = await Client.aggregate([
    {
      $match: {
        tenantId: tid,
        'mikrotik.serverId': { $ne: null },
      },
    },
    { $group: { _id: '$mikrotik.serverId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

async function lastJobActivityByServer(tenantId, serverIds) {
  const tid = mongoose.Types.ObjectId.isValid(tenantId) ? new mongoose.Types.ObjectId(tenantId) : null;
  if (!tid || !serverIds.length) return new Map();
  const oids = serverIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
  if (!oids.length) return new Map();
  const rows = await MikrotikSyncJob.aggregate([
    { $match: { tenantId: tid, serverId: { $in: oids } } },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: '$serverId',
        lastAt: { $first: '$updatedAt' },
        lastStatus: { $first: '$status' },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      String(r._id),
      { lastAt: r.lastAt ? r.lastAt.toISOString() : null, lastStatus: r.lastStatus || null },
    ]),
  );
}

/**
 * Lista servidores do tenant com snapshot RouterOS (um a um; falhas isoladas).
 * @param {string} tenantId
 * @param {{ timeoutMs?: number }} [opts]
 */
exports.listServersWithMonitoring = async (tenantId, opts = {}) => {
  const timeoutMs =
    opts.timeoutMs != null && Number.isFinite(Number(opts.timeoutMs))
      ? Math.min(120_000, Math.max(3_000, Number(opts.timeoutMs)))
      : 12_000;

  const tid = mongoose.Types.ObjectId.isValid(tenantId) ? new mongoose.Types.ObjectId(tenantId) : null;

  const servers = await MikrotikServer.find({ tenantId })
    .select('-password')
    .sort({ createdAt: -1 })
    .lean();

  const nodeById = new Map();
  if (tid) {
    const nodeOids = [
      ...new Set(
        servers
          .map((x) =>
            x.networkNodeId != null && mongoose.Types.ObjectId.isValid(String(x.networkNodeId))
              ? String(x.networkNodeId)
              : null,
          )
          .filter(Boolean),
      ),
    ].map((oid) => new mongoose.Types.ObjectId(oid));
    if (nodeOids.length) {
      const nodeRows = await NetworkNode.find({ tenantId: tid, _id: { $in: nodeOids } })
        .select('name code type status')
        .lean();
      for (const n of nodeRows) {
        nodeById.set(String(n._id), {
          id: String(n._id),
          name: n.name,
          code: n.code,
          type: n.type,
          status: n.status,
        });
      }
    }
  }

  const clientMap = await clientCountsByServer(tenantId);
  const serverIds = servers.map((s) => String(s._id));
  const jobMap = await lastJobActivityByServer(tenantId, serverIds);

  const generatedAt = new Date().toISOString();
  const out = [];

  const listConcurrency = Math.min(
    5,
    Math.max(1, Number.parseInt(String(process.env.MIKROTIK_LIST_CONCURRENCY || '4'), 10) || 4),
  );

  async function processOne(s) {
    const id = String(s._id);
    const nodeKey = s.networkNodeId != null ? String(s.networkNodeId) : null;
    const base = {
      id,
      name: s.name,
      host: s.host,
      port: s.port,
      isActive: Boolean(s.isActive),
      executionMode: s.executionMode != null ? String(s.executionMode) : 'auto',
      agentId: s.agentId != null ? String(s.agentId) : null,
      networkNodeId: nodeKey,
      networkNode: nodeKey && nodeById.has(nodeKey) ? nodeById.get(nodeKey) : null,
      monitoringChannel: null,
      executionAgentNode: null,
      totalClients: clientMap.get(id) || 0,
      online: false,
      lastError: null,
      lastPolledAt: null,
      lastSyncAt: null,
      lastJobStatus: null,
      identityName: null,
      version: null,
      board: null,
      uptime: null,
      cpuPercent: null,
      cpuCount: null,
      architectureName: null,
      memoryTotalBytes: null,
      memoryFreeBytes: null,
      diskTotalBytes: null,
      diskFreeBytes: null,
      temperature: null,
      voltage: null,
      interfaceTotal: 0,
      interfaceRunning: 0,
      interfaces: [],
      pppSecretCount: null,
      activePppSessionsTotal: null,
      alerts: [],
      alertsCount: 0,
      criticalAlertsCount: 0,
      warningAlertsCount: 0,
      infoAlertsCount: 0,
    };

    const jobInfo = jobMap.get(id);
    if (jobInfo) {
      base.lastSyncAt = jobInfo.lastAt;
      base.lastJobStatus = jobInfo.lastStatus;
    }

    if (!s.isActive) {
      base.lastError = 'Servidor marcado como inactivo no cadastro.';
      applyOperationalAlertFields(base);

      try {
        await saveTelemetrySnapshot({
          serverId: s._id,
          serverName: s.name || '',
          cpuPercent: base.cpuPercent || 0,

          memoryPercent:
            base.memoryTotalBytes && base.memoryFreeBytes != null
              ? Math.round(
                  100 -
                    (base.memoryFreeBytes / base.memoryTotalBytes) * 100,
                )
              : 0,

          pppOnline: base.activePppSessionsTotal || 0,

          interfaces: (base.interfaces || []).slice(0, 12).map((i) => ({
            name: i.name || '',
            rxMbps: Number(i.rxMbps || 0),
            txMbps: Number(i.txMbps || 0),
            running: Boolean(i.running),
          })),

          metadata: {
            monitoringChannel: base.monitoringChannel || '',
            online: Boolean(base.online),
            alerts: base.alertsCount || 0,
          },
        });
      } catch (err) {
        console.error(
          '[mikrotikTelemetry] persist error:',
          err && err.message ? err.message : err,
        );
      }

      return base;
    }

    let full;
    try {
      full = await MikrotikServer.findOne({ _id: s._id, tenantId }).lean();
    } catch (_) {
      full = null;
    }
    if (!full || !full.password) {
      base.lastError = 'Credencial do servidor não disponível.';
      applyOperationalAlertFields(base);
      return base;
    }

    let plainPassword;
    try {
      plainPassword = decrypt(full.password);
    } catch (err) {
      base.lastError = scrubSecretsFromMessage(err && err.message ? String(err.message) : 'Falha ao descriptografar credencial.');
      applyOperationalAlertFields(base);
      return base;
    }

    const serverLike = {
      host: full.host,
      port: full.port,
      username: full.username,
      password: plainPassword,
    };

    const route = await networkNodeRoutingService.resolveExecutionRoute(String(tenantId), {}, full);
    if (route.channel === 'ERROR') {
      base.monitoringChannel = 'ERROR';
      base.online = false;
      base.lastError = scrubSecretsFromMessage(route.message || route.code || 'NETWORK_ROUTE_ERROR');
      applyOperationalAlertFields(base);
      return base;
    }

    if (route.channel === 'REMOTE_AGENT') {
      base.monitoringChannel = 'REMOTE_AGENT';
      base.executionAgentNode = {
        id: String(route.networkNode._id),
        name: route.networkNode.name,
        code: route.networkNode.code,
        type: route.networkNode.type,
        status: route.networkNode.status,
      };
      try {
        const payload = {
          kind: 'SERVER_SNAPSHOT',
          routerApi: serverLike,
        };
        const tenantOid = mongoose.Types.ObjectId.isValid(String(tenantId))
          ? new mongoose.Types.ObjectId(String(tenantId))
          : tenantId;
        const { command } = await remoteAgentCommandService.enqueueServerMonitoringCommand({
          tenantId: tenantOid,
          networkNodeId: route.networkNode._id,
          serverId: full._id,
          kind: 'SERVER_SNAPSHOT',
          payload,
        });
        const remote = await waitRemoteAgentJsonResult(command._id, timeoutMs);
        if (remote.err) {
          throw new Error(remote.err);
        }
        const raw = remote.json ? (remote.json.raw ?? remote.json) : null;
        if (!raw || typeof raw !== 'object') {
          throw new Error('REMOTE_SNAPSHOT_EMPTY');
        }
        const norm = normalizeSnapshot({
          identity: Array.isArray(raw.identity) ? raw.identity[0] : raw.identity,
          resource: Array.isArray(raw.resource) ? raw.resource[0] : raw.resource,
          routerboard: Array.isArray(raw.routerboard) ? raw.routerboard[0] : raw.routerboard,
          health: Array.isArray(raw.health) ? raw.health[0] : raw.health,
          interfaces: raw.interfaces,
          pppSecretCount: raw.pppSecretCount,
          pppActiveTotal: raw.pppActiveTotal,
       });
        base.online = true;
        base.lastPolledAt = new Date().toISOString();
        base.identityName = norm.identityName;
        base.version = norm.version;
        base.board = norm.board;
        base.uptime = norm.uptime;
        base.cpuPercent = norm.cpuPercent;
        base.cpuCount = norm.cpuCount;
        base.architectureName = norm.architectureName;
        base.memoryTotalBytes = norm.memoryTotalBytes;
        base.memoryFreeBytes = norm.memoryFreeBytes;
        base.diskTotalBytes = norm.diskTotalBytes;
        base.diskFreeBytes = norm.diskFreeBytes;
        base.interfaces = trimInterfaceList(norm.interfaces);
        base.interfaceTotal = norm.interfaceTotal;
        base.interfaceRunning = norm.interfaceRunning;
        base.temperature = norm.temperature;
        base.voltage = norm.voltage;
        base.pppSecretCount = norm.pppSecretCount;
        base.activePppSessionsTotal = norm.pppActiveTotal != null ? norm.pppActiveTotal : null;
        applyOperationalAlertFields(base);
      } catch (err) {
        base.online = false;
        base.lastError = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
        applyOperationalAlertFields(base);
      }
      return base;
    }

    base.monitoringChannel = 'LOCAL_DIRECT';
    try {
      const raw = await withMikrotikConnection(serverLike, { timeoutMs }, async (api) => fetchOperationalSnapshot(api));
      const norm = normalizeSnapshot({
        identity: Array.isArray(raw.identity) ? raw.identity[0] : raw.identity,
        resource: Array.isArray(raw.resource) ? raw.resource[0] : raw.resource,
        routerboard: Array.isArray(raw.routerboard) ? raw.routerboard[0] : raw.routerboard,
          health: Array.isArray(raw.health) ? raw.health[0] : raw.health,
        interfaces: raw.interfaces,
        pppSecretCount: raw.pppSecretCount,
        pppActiveTotal: raw.pppActiveTotal,
      });
      base.online = true;
      base.lastPolledAt = new Date().toISOString();
      base.identityName = norm.identityName;
      base.version = norm.version;
      base.board = norm.board;
      base.uptime = norm.uptime;
      base.cpuPercent = norm.cpuPercent;
        base.cpuCount = norm.cpuCount;
        base.architectureName = norm.architectureName;
      base.memoryTotalBytes = norm.memoryTotalBytes;
      base.memoryFreeBytes = norm.memoryFreeBytes;
      base.diskTotalBytes = norm.diskTotalBytes;
      base.diskFreeBytes = norm.diskFreeBytes;
      base.interfaces = trimInterfaceList(norm.interfaces);
        base.interfaceTotal = norm.interfaceTotal;
        base.interfaceRunning = norm.interfaceRunning;
        base.temperature = norm.temperature;
        base.voltage = norm.voltage;
      base.pppSecretCount = norm.pppSecretCount;
      base.activePppSessionsTotal = norm.pppActiveTotal != null ? norm.pppActiveTotal : null;
      applyOperationalAlertFields(base);
    } catch (err) {
      base.online = false;
      base.lastError = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
      applyOperationalAlertFields(base);
    }

    return base;
  }

  for (let i = 0; i < servers.length; i += listConcurrency) {
    const slice = servers.slice(i, i + listConcurrency);
    const chunk = await Promise.all(slice.map((s) => processOne(s)));
    if (tid) {
      for (const b of chunk) {
        const sid = b && b.id != null ? String(b.id) : '';
        if (sid && mongoose.Types.ObjectId.isValid(sid)) {
          try {
            await persistServerSnapshot(tid, new mongoose.Types.ObjectId(sid), b);
            if (b.online) {
              await persistTelemetrySnapshot(tid, new mongoose.Types.ObjectId(sid), b);
            }
          } catch (err) {
            console.error(
              '[mikrotikServerMonitoring] list snapshot persist:',
              err && err.message ? err.message : err,
            );
          }
        }
      }
    }
    out.push(...chunk);
  }

  const summary = {
    totalServers: out.length,
    onlineServers: out.filter((x) => x.online).length,
    offlineServers: out.filter((x) => !x.online).length,
    totalClients: out.reduce((acc, x) => acc + (Number(x.totalClients) || 0), 0),
    totalPppSessions: out.reduce((acc, x) => acc + (x.activePppSessionsTotal != null ? Number(x.activePppSessionsTotal) : 0), 0),
    criticalAlerts: out.reduce((acc, x) => acc + (Number(x.criticalAlertsCount) || 0), 0),
    warningAlerts: out.reduce((acc, x) => acc + (Number(x.warningAlertsCount) || 0), 0),
    infoAlerts: out.reduce((acc, x) => acc + (Number(x.infoAlertsCount) || 0), 0),
    generatedAt,
  };

  return { generatedAt, summary, servers: out };
};

/**
 * Monitoramento detalhado de um servidor (interfaces completas, diagnóstico NOC).
 * @param {string} tenantId
 * @param {string} serverId
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>} null se servidor não existir no tenant
 */
exports.getServerMonitoringDetail = async (tenantId, serverId, opts = {}) => {
  const timeoutMs =
    opts.timeoutMs != null && Number.isFinite(Number(opts.timeoutMs))
      ? Math.min(120_000, Math.max(3_000, Number(opts.timeoutMs)))
      : 15_000;

  const id = String(serverId);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('ID inválido');
  }

  const tid = mongoose.Types.ObjectId.isValid(tenantId) ? new mongoose.Types.ObjectId(tenantId) : null;
  if (!tid) {
    throw ApiError.badRequest('Tenant inválido');
  }

  const serverOid = new mongoose.Types.ObjectId(id);

  const s = await MikrotikServer.findOne({ _id: id, tenantId: tid }).select('-password').lean();
  if (!s) return null;

  let networkNode = null;
  if (s.networkNodeId && mongoose.Types.ObjectId.isValid(String(s.networkNodeId))) {
    const n = await NetworkNode.findOne({ _id: s.networkNodeId, tenantId: tid })
      .select('name code type status')
      .lean();
    if (n) {
      networkNode = {
        id: String(n._id),
        name: n.name,
        code: n.code,
        type: n.type,
        status: n.status,
      };
    }
  }

  const totalClients = await Client.countDocuments({
    tenantId: tid,
    'mikrotik.serverId': serverOid,
  });

  const job = await MikrotikSyncJob.findOne({ tenantId: tid, serverId: serverOid })
    .sort({ updatedAt: -1 })
    .select('updatedAt status')
    .lean();

  const generatedAt = new Date().toISOString();
  const base = {
    generatedAt,
    id,
    name: s.name,
    host: s.host,
    port: s.port,
    isActive: Boolean(s.isActive),
    executionMode: s.executionMode != null ? String(s.executionMode) : 'auto',
    agentId: s.agentId != null ? String(s.agentId) : null,
    networkNodeId: s.networkNodeId != null ? String(s.networkNodeId) : null,
    networkNode,
    monitoringChannel: null,
    executionAgentNode: null,
    totalClients,
    online: false,
    lastError: null,
    lastPolledAt: null,
    lastSyncAt: job && job.updatedAt ? job.updatedAt.toISOString() : null,
    lastJobStatus: job && job.status ? job.status : null,
    identityName: null,
    version: null,
    board: null,
    uptime: null,
    cpuPercent: null,
    memoryTotalBytes: null,
    memoryFreeBytes: null,
    diskTotalBytes: null,
    diskFreeBytes: null,
    interfaces: [],
    pppSecretCount: null,
    activePppSessions: [],
    activePppSessionsTotal: 0,
    activePppSessionsTruncated: false,
  };

  if (!s.isActive) {
    base.lastError = 'Servidor marcado como inactivo no cadastro.';
    return finalizeDetailResponse(tid, serverOid, base);
  }

  let full;
  try {
    full = await MikrotikServer.findOne({ _id: id, tenantId: tid }).lean();
  } catch (_) {
    full = null;
  }
  if (!full || !full.password) {
    base.lastError = 'Credencial do servidor não disponível.';
    return finalizeDetailResponse(tid, serverOid, base);
  }

  let plainPassword;
  try {
    plainPassword = decrypt(full.password);
  } catch (err) {
    base.lastError = scrubSecretsFromMessage(err && err.message ? String(err.message) : 'Falha ao descriptografar credencial.');
    return finalizeDetailResponse(tid, serverOid, base);
  }

  const serverLike = {
    host: full.host,
    port: full.port,
    username: full.username,
    password: plainPassword,
  };

  const route = await networkNodeRoutingService.resolveExecutionRoute(String(tenantId), {}, full);
  if (route.channel === 'ERROR') {
    base.monitoringChannel = 'ERROR';
    base.online = false;
    base.lastError = scrubSecretsFromMessage(route.message || route.code || 'NETWORK_ROUTE_ERROR');
    return finalizeDetailResponse(tid, serverOid, base);
  }

  if (route.channel === 'REMOTE_AGENT') {
    base.monitoringChannel = 'REMOTE_AGENT';
    base.executionAgentNode = {
      id: String(route.networkNode._id),
      name: route.networkNode.name,
      code: route.networkNode.code,
      type: route.networkNode.type,
      status: route.networkNode.status,
    };
    try {
      const payload = {
        kind: 'SERVER_SNAPSHOT_DETAIL',
        routerApi: serverLike,
      };
      const { command } = await remoteAgentCommandService.enqueueServerMonitoringCommand({
        tenantId: tid,
        networkNodeId: route.networkNode._id,
        serverId: full._id,
        kind: 'SERVER_SNAPSHOT_DETAIL',
        payload,
      });
      const remote = await waitRemoteAgentJsonResult(command._id, timeoutMs);
      if (remote.err) {
        throw new Error(remote.err);
      }
      const raw = remote.json ? (remote.json.raw ?? remote.json) : null;
      if (!raw || typeof raw !== 'object') {
        throw new Error('REMOTE_SNAPSHOT_EMPTY');
      }
      const norm = normalizeSnapshotDetail(raw);
      base.online = true;
      base.lastPolledAt = new Date().toISOString();
      base.identityName = norm.identityName;
      base.version = norm.version;
      base.board = norm.board;
      base.uptime = norm.uptime;
      base.cpuPercent = norm.cpuPercent;
        base.cpuCount = norm.cpuCount;
        base.architectureName = norm.architectureName;
      base.memoryTotalBytes = norm.memoryTotalBytes;
      base.memoryFreeBytes = norm.memoryFreeBytes;
      base.diskTotalBytes = norm.diskTotalBytes;
      base.diskFreeBytes = norm.diskFreeBytes;
      base.interfaces = trimInterfaceList(norm.interfaces);
        base.interfaceTotal = norm.interfaceTotal;
        base.interfaceRunning = norm.interfaceRunning;
        base.temperature = norm.temperature;
        base.voltage = norm.voltage;
      base.pppSecretCount = norm.pppSecretCount;
      base.activePppSessions = norm.activePppSessions;
      base.activePppSessionsTotal = norm.activePppSessionsTotal;
      base.activePppSessionsTruncated = norm.activePppSessionsTruncated;
    } catch (err) {
      base.online = false;
      base.lastError = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
    }
    return finalizeDetailResponse(tid, serverOid, base);
  }

  base.monitoringChannel = 'LOCAL_DIRECT';
  try {
    const raw = await withMikrotikConnection(serverLike, { timeoutMs }, async (api) =>
      fetchOperationalSnapshotDetail(api),
    );
    const norm = normalizeSnapshotDetail(raw);
    base.online = true;
    base.lastPolledAt = new Date().toISOString();
    base.identityName = norm.identityName;
    base.version = norm.version;
    base.board = norm.board;
    base.uptime = norm.uptime;
    base.cpuPercent = norm.cpuPercent;
        base.cpuCount = norm.cpuCount;
        base.architectureName = norm.architectureName;
    base.memoryTotalBytes = norm.memoryTotalBytes;
    base.memoryFreeBytes = norm.memoryFreeBytes;
    base.diskTotalBytes = norm.diskTotalBytes;
    base.diskFreeBytes = norm.diskFreeBytes;
      base.interfaces = trimInterfaceList(norm.interfaces);
        base.interfaceTotal = norm.interfaceTotal;
        base.interfaceRunning = norm.interfaceRunning;
        base.temperature = norm.temperature;
        base.voltage = norm.voltage;
    base.pppSecretCount = norm.pppSecretCount;
    base.activePppSessions = norm.activePppSessions;
    base.activePppSessionsTotal = norm.activePppSessionsTotal;
    base.activePppSessionsTruncated = norm.activePppSessionsTruncated;
  } catch (err) {
    base.online = false;
    base.lastError = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
  }

  return finalizeDetailResponse(tid, serverOid, base);
};
