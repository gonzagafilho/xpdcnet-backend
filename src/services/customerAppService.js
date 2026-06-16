const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Invoice = require('../models/Invoice');
const BillingInvoice = require('../models/billing/BillingInvoice');
const MikrotikServer = require('../models/MikrotikServer');
const MikrotikServerSnapshot = require('../models/MikrotikServerSnapshot');
const NetworkNode = require('../models/NetworkNode');
const NetworkNodeMetric = require('../models/NetworkNodeMetric');
const MikrotikTelemetrySnapshot = require('../models/MikrotikTelemetrySnapshot');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const NetworkIncident = require('../models/NetworkIncident');
const SupportTicket = require('../models/SupportTicket');
const Notification = require('../models/Notification');

function oid(value, field = 'id') {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest(`${field} invalido`);
  return new mongoose.Types.ObjectId(String(value));
}

function limitFromQuery(query = {}) {
  return Math.min(100, Math.max(1, Number(query.limit) || 50));
}

function trim(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}


function maskAccessUsername(value) {
  const username = String(value == null ? '' : value).trim();
  if (!username) return '';
  if (username.length <= 2) return `${username.slice(0, 1)}***`;
  if (username.length <= 5) return `${username.slice(0, 2)}***`;
  return `${username.slice(0, 2)}***${username.slice(-2)}`;
}

function roundMetric(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(2));
}

function metricFromObject(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] != null && Number.isFinite(Number(obj[key]))) return roundMetric(obj[key]);
  }
  return null;
}

function latestDate(...values) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] || null;
}

function firstObjectId(...values) {
  for (const value of values) {
    if (value && mongoose.Types.ObjectId.isValid(String(value))) return value;
  }
  return null;
}

function unwrapSnapshotPayload(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return unwrapSnapshotPayload(JSON.parse(value));
    } catch (_) {
      return null;
    }
  }
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    if (value.raw) return unwrapSnapshotPayload(value.raw);
    if (value.data) return unwrapSnapshotPayload(value.data);
    if (value.resultData) return unwrapSnapshotPayload(value.resultData);
    if (value.result) return unwrapSnapshotPayload(value.result);
    return value;
  }
  return null;
}

function pppSessionsFromPayload(payload) {
  const data = unwrapSnapshotPayload(payload);
  if (!data) return [];
  if (Array.isArray(data)) return data.filter((item) => item && typeof item === 'object');
  const candidates = [
    data.activePppSessions,
    data.pppActive?.items,
    data.pppActive,
    data.pppActiveSessions,
    data.sessions,
    data.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item) => item && typeof item === 'object');
  }
  return [];
}

function pppTotalFromPayload(payload) {
  const data = unwrapSnapshotPayload(payload);
  if (!data || Array.isArray(data) || typeof data !== 'object') return null;
  const value = data.activePppSessionsTotal ?? data.pppActiveTotal ?? data.pppActive?.total ?? data.total;
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function findSessionByUsername(sessions = [], username = '') {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  return sessions.find((session) => {
    const name = String(session.name ?? session.username ?? session.user ?? session.login ?? '').trim().toLowerCase();
    return name && name === target;
  }) || null;
}

function sessionDownloadMbps(session) {
  return metricFromObject(session, ['downloadMbps', 'rxMbps', 'download_mbps', 'rxRateMbps']);
}

function sessionUploadMbps(session) {
  return metricFromObject(session, ['uploadMbps', 'txMbps', 'upload_mbps', 'txRateMbps']);
}

function sessionQuality(session) {
  return {
    pingMs: metricFromObject(session, ['pingMs', 'ping', 'latencyMs']),
    jitterMs: metricFromObject(session, ['jitterMs', 'jitter']),
    packetLoss: metricFromObject(session, ['packetLoss', 'packetLossPercent', 'loss']),
  };
}

function bytesFromObject(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] == null || String(obj[key]).trim() === '') continue;
    const value = Number(obj[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function sessionRxBytes(session) {
  return bytesFromObject(session, ['rxBytes', 'rxByte', 'rx-byte', 'rx_bytes', 'bytesIn', 'inputBytes', 'uploadBytes', 'limitBytesIn']);
}

function sessionTxBytes(session) {
  return bytesFromObject(session, ['txBytes', 'txByte', 'tx-byte', 'tx_bytes', 'bytesOut', 'outputBytes', 'downloadBytes', 'limitBytesOut']);
}

function emptyPppoeHistory(message = 'Sem histórico PPPoE recente.') {
  const zero = { downloadGB: 0, uploadGB: 0, totalGB: 0 };
  const today = new Date();
  const buildZeroSeries = (days) => Array.from({ length: days }, (_, index) => ({
    date: dayKey(addDays(today, index - (days - 1))),
    ...zero,
  }));

  return {
    today: { ...zero },
    yesterday: { ...zero },
    month: { ...zero },
    series7d: buildZeroSeries(7),
    series30d: buildZeroSeries(30),
    source: 'empty',
    message,
  };
}

function dayKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

function gb(bytes) {
  return Number((Math.max(0, Number(bytes || 0)) / 1024 / 1024 / 1024).toFixed(3));
}

function usageBucket(downloadBytes = 0, uploadBytes = 0) {
  const downloadGB = gb(downloadBytes);
  const uploadGB = gb(uploadBytes);
  return { downloadGB, uploadGB, totalGB: Number((downloadGB + uploadGB).toFixed(3)) };
}

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function safeClient(client) {
  if (!client) return null;
  return {
    _id: String(client._id),
    fullName: client.fullName || '',
    email: client.email || '',
    phone: client.phone || '',
    status: client.status || '',
    dueDay: client.dueDay || null,
    monthlyPrice: Number(client.monthlyPrice || 0),
    address: {
      city: client.address?.city || '',
      state: client.address?.state || '',
      neighborhood: client.address?.neighborhood || '',
    },
    createdAt: client.createdAt || null,
  };
}

function safePlan(plan) {
  if (!plan) return null;
  return {
    _id: String(plan._id),
    name: plan.name || '',
    speedMbps: Number(plan.speedMbps || 0),
    price: Number(plan.price || 0),
    billingCycle: plan.billingCycle || 'monthly',
    authType: plan.authType || 'pppoe',
    mikrotik: {
      profile: plan.mikrotik?.profile || '',
      rateLimit: plan.mikrotik?.rateLimit || '',
      priority: plan.mikrotik?.priority || null,
    },
    isActive: plan.isActive !== false,
  };
}

function invoiceSummary(inv, billing = null) {
  return {
    _id: String(inv._id),
    amount: Number(inv.amount || 0),
    dueDate: inv.dueDate || null,
    status: inv.status || '',
    paidAt: inv.paidAt || null,
    competence: inv.competence || '',
    description: inv.description || '',
    hasBillingInvoice: Boolean(billing),
    billingInvoiceId: billing ? String(billing._id) : null,
    billingStatus: billing ? billing.internalStatus || null : null,
    updatedAt: inv.updatedAt || null,
  };
}

function safeBillingInvoiceForPayment(billing) {
  if (!billing) return null;
  const raw = billing.raw && typeof billing.raw === 'object' ? billing.raw : {};
  const pixCopyPaste = raw.pixCopyPaste || raw.pix_copy_paste || billing.pixPayload || '';
  return {
    _id: String(billing._id),
    providerChargeId: billing.providerChargeId || '',
    providerStatus: billing.providerStatus || '',
    internalStatus: billing.internalStatus || '',
    amount: Number(billing.amount || 0),
    dueDate: billing.dueDate || null,
    paidAt: billing.paidAt || null,
    checkoutUrl: billing.checkoutUrl || '',
    pixPayload: billing.pixPayload || '',
    pixCopyPaste: pixCopyPaste || '',
    pixQrCodeUrl: billing.pixQrCodeUrl || '',
    boletoUrl: billing.boletoUrl || '',
    boletoBarcode: billing.boletoBarcode || '',
    updatedAt: billing.updatedAt || null,
  };
}

function basicAlerts(client, invoices = [], connection = null) {
  const alerts = [];
  const status = String(client.status || '');
  if (['blocked', 'disabled', 'suspended', 'delinquent'].includes(status)) {
    alerts.push({ type: 'account_status', severity: status === 'delinquent' ? 'warning' : 'critical', message: `Status atual: ${status}` });
  }
  const overdueCount = invoices.filter((i) => i.status === 'overdue').length;
  if (overdueCount > 0) alerts.push({ type: 'invoice_overdue', severity: 'warning', message: `${overdueCount} fatura(s) vencida(s).` });
  if (connection && connection.status === 'offline') {
    alerts.push({ type: 'connection_offline', severity: 'warning', message: 'Conexao sem sessao online detectada na ultima leitura disponivel.' });
  }
  return alerts;
}

function mergeAlerts(...groups) {
  const seen = new Set();
  const merged = [];
  for (const alert of groups.flat().filter(Boolean)) {
    const key = `${alert.type || ''}:${alert.message || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(alert);
  }
  return merged;
}

async function loadContext(tenantId, clientId) {
  const tid = oid(tenantId, 'tenantId');
  const cid = oid(clientId, 'clientId');
  const client = await Client.findOne({ _id: cid, tenantId: tid }).lean();
  if (!client) throw ApiError.notFound('Cliente nao encontrado');
  const plan = client.planId ? await Plan.findOne({ _id: client.planId, tenantId: tid }).lean() : null;
  return { tid, cid, client, plan };
}

async function recentInvoices(tenantId, clientId, limit = 12) {
  return Invoice.find({ tenantId, clientId }).sort({ dueDate: -1 }).limit(limit).lean();
}

async function billingByInvoiceIds(tenantId, invoiceIds) {
  const rows = await BillingInvoice.find({ tenantId, invoiceId: { $in: invoiceIds } }).sort({ updatedAt: -1 }).lean();
  const map = new Map();
  for (const row of rows) {
    const key = String(row.invoiceId);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

async function connectionSnapshot(tenantId, client, plan = null) {
  const serverId = client.mikrotik?.serverId || null;
  const server = serverId
    ? await MikrotikServer.findOne({ _id: serverId, tenantId }).select('_id name isActive networkNodeId agentId').lean()
    : null;
  const nodeId = firstObjectId(client.networkNodeId, server?.networkNodeId, server?.agentId);

  const telemetryIds = [serverId, nodeId].filter(Boolean);
  const [node, latestSnapshot, latestMetric, telemetrySnapshot, lastCommand, openIncident] = await Promise.all([
    nodeId ? NetworkNode.findOne({ _id: nodeId, tenantId }).select('_id name status agentLastSeenAt healthLevel healthScore').lean() : null,
    serverId ? MikrotikServerSnapshot.findOne({ tenantId, serverId }).sort({ generatedAt: -1, createdAt: -1 }).lean() : null,
    nodeId ? NetworkNodeMetric.findOne({ tenantId: String(tenantId), nodeId }).sort({ sampledAt: -1, createdAt: -1 }).lean() : null,
    telemetryIds.length ? MikrotikTelemetrySnapshot.findOne({ serverId: { $in: telemetryIds } }).sort({ createdAt: -1 }).lean() : null,
    nodeId || serverId || client._id
      ? RemoteAgentCommand.findOne({
          tenantId,
          ...(client._id ? { clientId: client._id } : {}),
          ...(nodeId ? { networkNodeId: nodeId } : {}),
          ...(serverId ? { serverId } : {}),
        })
          .select('kind status resultSuccess completedAt updatedAt createdAt')
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean()
      : null,
    nodeId
      ? NetworkIncident.findOne({ tenantId: String(tenantId), nodeId, status: 'open' })
          .select('type severity title message startedAt lastSeenAt')
          .sort({ lastSeenAt: -1, startedAt: -1 })
          .lean()
      : null,
  ]);

  const statusSource = latestSnapshot
    ? latestSnapshot.online
    : node?.status || latestMetric?.status || null;
  const status = typeof statusSource === 'boolean'
    ? statusSource ? 'online' : 'offline'
    : ['online', 'offline'].includes(String(statusSource)) ? String(statusSource) : 'unknown';
  const activePppTotal = latestSnapshot?.activePppTotal != null ? Number(latestSnapshot.activePppTotal) : latestMetric?.pppOnlineCount ?? telemetrySnapshot?.pppOnline ?? null;
  const pppSecretCount = latestSnapshot?.pppSecretCount != null ? Number(latestSnapshot.pppSecretCount) : null;
  const lastSignalAt = latestMetric?.sampledAt || telemetrySnapshot?.createdAt || null;
  const lastUpdateAt = latestDate(
    latestSnapshot?.generatedAt,
    latestSnapshot?.createdAt,
    latestMetric?.sampledAt,
    telemetrySnapshot?.createdAt,
    node?.agentLastSeenAt,
    lastCommand?.completedAt,
    lastCommand?.updatedAt,
  );
  const alerts = [];

  if (latestSnapshot?.lastError) {
    alerts.push({ type: 'monitoring', severity: 'warning', message: 'Ultima leitura de conexao registrou erro.' });
  }
  if (status === 'offline') {
    alerts.push({ type: 'connection_offline', severity: 'warning', message: 'Conexao sem sessao online detectada na ultima leitura disponivel.' });
  }
  if (telemetrySnapshot && ['warning', 'critical'].includes(String(telemetrySnapshot.health))) {
    alerts.push({ type: 'telemetry', severity: telemetrySnapshot.health === 'critical' ? 'critical' : 'warning', message: 'Equipamento com sinal de atencao na ultima telemetria.' });
  }
  if (openIncident) {
    alerts.push({
      type: openIncident.type || 'incident',
      severity: openIncident.severity || 'warning',
      message: trim(openIncident.title || openIncident.message || 'Incidente operacional em acompanhamento.', 120),
    });
  }

  return {
    status,
    plan: safePlan(plan),
    access: {
      authType: client.access?.authType || plan?.authType || 'pppoe',
      usernameMasked: maskAccessUsername(client.access?.username),
    },
    server: server
      ? {
          _id: String(server._id),
          name: server.name || '',
          isActive: server.isActive !== false,
        }
      : null,
    networkNode: node
      ? {
          _id: String(node._id),
          name: node.name || '',
          status: node.status || 'unknown',
          healthLevel: node.healthLevel || null,
          healthScore: node.healthScore ?? null,
          agentLastSeenAt: node.agentLastSeenAt || null,
        }
      : null,
    lastSession: latestSnapshot || latestMetric || telemetrySnapshot
      ? {
          sampledAt: latestSnapshot?.generatedAt || latestSnapshot?.createdAt || latestMetric?.sampledAt || telemetrySnapshot?.createdAt || null,
          activePppTotal: activePppTotal != null ? Number(activePppTotal) : null,
          pppSecretCount,
        }
      : null,
    lastSignal: latestMetric || telemetrySnapshot
      ? {
          sampledAt: lastSignalAt,
          source: latestMetric ? 'network_metric' : 'telemetry',
          health: telemetrySnapshot?.health || node?.healthLevel || null,
          cpuPercent: roundMetric(latestMetric?.cpuLoad ?? telemetrySnapshot?.cpuPercent),
          pppOnline: activePppTotal != null ? Number(activePppTotal) : null,
          totalRxMbps: roundMetric(latestMetric?.totalRxMbps),
          totalTxMbps: roundMetric(latestMetric?.totalTxMbps),
        }
      : null,
    lastUpdateAt: lastUpdateAt ? lastUpdateAt.toISOString() : null,
    lastCommand: lastCommand
      ? {
          kind: lastCommand.kind || '',
          status: lastCommand.status || '',
          success: lastCommand.resultSuccess,
          completedAt: lastCommand.completedAt || null,
          updatedAt: lastCommand.updatedAt || null,
        }
      : null,
    mikrotikSync: {
      enabled: Boolean(client.mikrotik?.enabled),
      state: client.mikrotik?.sync?.state || 'never',
      lastSuccessAt: client.mikrotik?.sync?.lastSuccessAt || client.mikrotik?.syncedAt || null,
      lastAttemptAt: client.mikrotik?.sync?.lastAttemptAt || null,
    },
    alerts,
  };
}

exports.getDashboard = async (tenantId, clientId) => {
  const { tid, cid, client, plan } = await loadContext(tenantId, clientId);
  const invoices = await recentInvoices(tid, cid, 12);
  const billingMap = await billingByInvoiceIds(tid, invoices.map((i) => i._id));
  const connection = await connectionSnapshot(tid, client, plan);
  const nextInvoice = invoices
    .filter((i) => ['pending', 'overdue'].includes(i.status))
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] || null;
  const openAmount = invoices
    .filter((i) => ['pending', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  return {
    client: safeClient(client),
    plan: safePlan(plan),
    status: client.status,
    mainDueDate: nextInvoice ? nextInvoice.dueDate : null,
    financialSummary: {
      openInvoices: invoices.filter((i) => ['pending', 'overdue'].includes(i.status)).length,
      overdueInvoices: invoices.filter((i) => i.status === 'overdue').length,
      paidInvoices: invoices.filter((i) => i.status === 'paid').length,
      openAmount: Number(openAmount.toFixed(2)),
      nextInvoice: nextInvoice ? invoiceSummary(nextInvoice, billingMap.get(String(nextInvoice._id))) : null,
    },
    connection,
    alerts: mergeAlerts(basicAlerts(client, invoices, connection), connection.alerts || []),
  };
};

exports.getExecutiveDashboard = async (tenantId, clientId) => {
  const { tid, cid, client, plan } = await loadContext(tenantId, clientId);
  const [invoices, openTickets, unreadNotifications] = await Promise.all([
    recentInvoices(tid, cid, 24),
    SupportTicket.countDocuments({ tenantId: tid, clientId: cid, status: { $in: ['open', 'in_progress'] } }),
    Notification.countDocuments({ tenantId: tid, clientId: cid, isRead: false }),
  ]);
  const connection = await connectionSnapshot(tid, client, plan);
  const pendingInvoices = invoices.filter((i) => i.status === 'pending').length;
  const overdueInvoices = invoices.filter((i) => i.status === 'overdue').length;
  const nextInvoice = invoices
    .filter((i) => ['pending', 'overdue'].includes(i.status))
    .sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))[0] || null;
  const healthScore = connection.networkNode?.healthScore != null
    ? Number(connection.networkNode.healthScore)
    : connection.lastSignal?.health === 'critical' ? 40
      : connection.lastSignal?.health === 'warning' ? 70
        : connection.status === 'online' ? 100
          : connection.status === 'offline' ? 0
            : null;

  return {
    client: {
      fullName: client.fullName || '',
      status: client.status || '',
    },
    internet: {
      status: connection.status,
      healthScore,
    },
    plan: {
      name: plan?.name || '',
      speed: plan?.speedMbps ? `${Number(plan.speedMbps)} Mbps` : '',
    },
    billing: {
      pendingInvoices,
      nextDueDate: nextInvoice ? nextInvoice.dueDate : null,
      overdueInvoices,
    },
    support: {
      openTickets: Number(openTickets || 0),
    },
    notifications: {
      unreadCount: Number(unreadNotifications || 0),
    },
    connection: {
      lastUpdateAt: connection.lastUpdateAt || null,
    },
  };
};

exports.getPlan = async (tenantId, clientId) => {
  const { client, plan } = await loadContext(tenantId, clientId);
  return {
    plan: safePlan(plan),
    speedMbps: plan ? Number(plan.speedMbps || 0) : null,
    amount: Number(client.monthlyPrice || plan?.price || 0),
    dueDay: client.dueDay || null,
    status: client.status || '',
    billingCycle: plan?.billingCycle || 'monthly',
  };
};

exports.getConnection = async (tenantId, clientId) => {
  const { tid, client, plan } = await loadContext(tenantId, clientId);
  return connectionSnapshot(tid, client, plan);
};

exports.getPppoe = async (tenantId, clientId) => {
  const { tid, client, plan } = await loadContext(tenantId, clientId);
  const authType = client.access?.authType || plan?.authType || 'pppoe';
  const username = String(client.access?.username || '').trim();
  const usernameMasked = maskAccessUsername(username);
  const alerts = [];

  const base = {
    status: 'unknown',
    usernameMasked,
    currentIp: null,
    serverName: null,
    uptime: null,
    connectedAt: null,
    lastUpdateAt: null,
    trafficNow: {
      downloadMbps: null,
      uploadMbps: null,
    },
    quality: {
      pingMs: null,
      jitterMs: null,
      packetLoss: null,
    },
    series: [],
    alerts,
  };

  if (authType !== 'pppoe') {
    alerts.push({ type: 'not_pppoe', severity: 'info', message: 'Seu acesso cadastrado nao e PPPoE.' });
    return base;
  }

  if (!username) {
    alerts.push({ type: 'missing_username', severity: 'warning', message: 'Usuario PPPoE nao encontrado no cadastro.' });
    return base;
  }

  const serverId = client.mikrotik?.serverId || null;
  const server = serverId
    ? await MikrotikServer.findOne({ _id: serverId, tenantId: tid }).select('_id name isActive networkNodeId agentId').lean()
    : null;
  const nodeId = firstObjectId(client.networkNodeId, server?.networkNodeId, server?.agentId);
  const node = nodeId
    ? await NetworkNode.findOne({ _id: nodeId, tenantId: tid }).select('_id name status agentLastSeenAt').lean()
    : null;

  base.serverName = server?.name || node?.name || null;

  const commandOr = [];
  if (client._id) commandOr.push({ clientId: client._id });
  if (serverId) commandOr.push({ serverId });
  if (nodeId) commandOr.push({ networkNodeId: nodeId });

  const [commands, latestMetric, telemetrySnapshot] = await Promise.all([
    commandOr.length
      ? RemoteAgentCommand.find({
          tenantId: tid,
          status: 'done',
          resultSuccess: true,
          kind: { $in: ['SERVER_SNAPSHOT_DETAIL', 'SERVER_SNAPSHOT', 'READ_PPP_ACTIVE'] },
          $and: [
            { $or: commandOr },
            {
              $or: [
                { completedAt: { $gte: since } },
                { updatedAt: { $gte: since } },
                { createdAt: { $gte: since } },
              ],
            },
          ],
        })
          .select('kind resultData completedAt updatedAt createdAt serverId networkNodeId')
          .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
          .limit(24)
          .lean()
      : [],
    nodeId ? NetworkNodeMetric.findOne({ tenantId: String(tid), nodeId }).sort({ sampledAt: -1, createdAt: -1 }).lean() : null,
    [serverId, nodeId].filter(Boolean).length
      ? MikrotikTelemetrySnapshot.findOne({ serverId: { $in: [serverId, nodeId].filter(Boolean) } }).sort({ createdAt: -1 }).lean()
      : null,
  ]);

  let latestCommandWithList = null;
  let latestSession = null;
  let latestTotal = null;

  for (const command of commands) {
    const sessions = pppSessionsFromPayload(command.resultData);
    if (sessions.length && !latestCommandWithList) latestCommandWithList = command;
    const session = findSessionByUsername(sessions, username);
    const total = pppTotalFromPayload(command.resultData);
    if (latestTotal == null && total != null) latestTotal = total;
    if (session) {
      latestSession = { session, command };
      break;
    }
  }

  const series = commands
    .slice()
    .reverse()
    .map((command) => {
      const session = findSessionByUsername(pppSessionsFromPayload(command.resultData), username);
      if (!session) return null;
      const downloadMbps = sessionDownloadMbps(session);
      const uploadMbps = sessionUploadMbps(session);
      if (downloadMbps == null && uploadMbps == null) return null;
      const sampledAt = command.completedAt || command.updatedAt || command.createdAt;
      return {
        time: timeLabel(sampledAt),
        downloadMbps,
        uploadMbps,
      };
    })
    .filter(Boolean)
    .slice(-10);

  const lastKnownAt = latestDate(
    latestSession?.command?.completedAt,
    latestSession?.command?.updatedAt,
    latestCommandWithList?.completedAt,
    latestCommandWithList?.updatedAt,
    latestMetric?.sampledAt,
    telemetrySnapshot?.createdAt,
    node?.agentLastSeenAt,
  );

  if (latestSession) {
    const session = latestSession.session;
    const quality = sessionQuality(session);
    base.status = 'online';
    base.currentIp = session.address || session.remoteAddress || null;
    base.uptime = session.uptime || null;
    base.lastUpdateAt = lastKnownAt ? lastKnownAt.toISOString() : null;
    base.trafficNow = {
      downloadMbps: sessionDownloadMbps(session),
      uploadMbps: sessionUploadMbps(session),
    };
    base.quality = quality;
    base.series = series;

    if (base.trafficNow.downloadMbps == null && base.trafficNow.uploadMbps == null) {
      alerts.push({ type: 'traffic_unavailable', severity: 'info', message: 'Sessao PPPoE encontrada, mas sem dados recentes de trafego por cliente.' });
    }
    if (!series.length) {
      alerts.push({ type: 'series_unavailable', severity: 'info', message: 'Sem pontos recentes de grafico para esta sessao PPPoE.' });
    }
    return base;
  }

  base.lastUpdateAt = lastKnownAt ? lastKnownAt.toISOString() : null;

  if (latestCommandWithList) {
    base.status = 'offline';
    alerts.push({ type: 'session_offline', severity: 'warning', message: 'Nenhuma sessao PPPoE ativa encontrada para seu usuario na ultima leitura.' });
    return base;
  }

  if (latestTotal != null || latestMetric || telemetrySnapshot) {
    alerts.push({ type: 'no_client_session_snapshot', severity: 'info', message: 'Sem dados recentes da sua sessao PPPoE individual.' });
  } else {
    alerts.push({ type: 'no_recent_data', severity: 'info', message: 'Sem dados recentes de PPPoE para exibir.' });
  }

  return base;
};


exports.getCustomerPppoeHistory = async (tenantId, clientId) => {
  const { tid, client, plan } = await loadContext(tenantId, clientId);
  const authType = client.access?.authType || plan?.authType || 'pppoe';
  const username = String(client.access?.username || '').trim();

  if (authType !== 'pppoe') return emptyPppoeHistory('Seu acesso cadastrado nao e PPPoE.');
  if (!username) return emptyPppoeHistory('Usuario PPPoE nao encontrado no cadastro.');

  const serverId = client.mikrotik?.serverId || null;
  const server = serverId
    ? await MikrotikServer.findOne({ _id: serverId, tenantId: tid }).select('_id networkNodeId agentId').lean()
    : null;
  const nodeId = firstObjectId(client.networkNodeId, server?.networkNodeId, server?.agentId);
  const commandOr = [];
  if (client._id) commandOr.push({ clientId: client._id });
  if (serverId) commandOr.push({ serverId });
  if (nodeId) commandOr.push({ networkNodeId: nodeId });

  const since = addDays(new Date(), -35);
  const [commands, latestMetric, telemetrySnapshot] = await Promise.all([
    commandOr.length
      ? RemoteAgentCommand.find({
          tenantId: tid,
          status: 'done',
          resultSuccess: true,
          kind: { $in: ['SERVER_SNAPSHOT_DETAIL', 'SERVER_SNAPSHOT', 'READ_PPP_ACTIVE'] },
          $and: [
            { $or: commandOr },
            {
              $or: [
                { completedAt: { $gte: since } },
                { updatedAt: { $gte: since } },
                { createdAt: { $gte: since } },
              ],
            },
          ],
        })
          .select('resultData completedAt updatedAt createdAt')
          .sort({ completedAt: 1, updatedAt: 1, createdAt: 1 })
          .limit(500)
          .lean()
      : [],
    nodeId ? NetworkNodeMetric.findOne({ tenantId: String(tid), nodeId }).sort({ sampledAt: -1, createdAt: -1 }).lean() : null,
    [serverId, nodeId].filter(Boolean).length
      ? MikrotikTelemetrySnapshot.findOne({ serverId: { $in: [serverId, nodeId].filter(Boolean) } }).sort({ createdAt: -1 }).lean()
      : null,
  ]);

  const samples = [];
  for (const command of commands) {
    const sampledAt = command.completedAt || command.updatedAt || command.createdAt;
    if (!sampledAt || new Date(sampledAt) < since) continue;
    const session = findSessionByUsername(pppSessionsFromPayload(command.resultData), username);
    if (!session) continue;
    const rxBytes = sessionRxBytes(session);
    const txBytes = sessionTxBytes(session);
    if (rxBytes == null && txBytes == null) continue;
    samples.push({ sampledAt: new Date(sampledAt), rxBytes, txBytes });
  }

  samples.sort((a, b) => a.sampledAt - b.sampledAt);
  if (samples.length < 2) {
    const msg = latestMetric || telemetrySnapshot
      ? 'Sem histórico PPPoE recente por usuario.'
      : 'Sem histórico PPPoE recente.';
    return emptyPppoeHistory(msg);
  }

  const byDay = new Map();
  let hasDelta = false;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const current = samples[i];
    const rxDelta = current.rxBytes != null && prev.rxBytes != null ? current.rxBytes - prev.rxBytes : 0;
    const txDelta = current.txBytes != null && prev.txBytes != null ? current.txBytes - prev.txBytes : 0;
    const uploadBytes = rxDelta > 0 ? rxDelta : 0;
    const downloadBytes = txDelta > 0 ? txDelta : 0;
    if (!uploadBytes && !downloadBytes) continue;
    hasDelta = true;
    const key = dayKey(current.sampledAt);
    const bucket = byDay.get(key) || { downloadBytes: 0, uploadBytes: 0 };
    bucket.downloadBytes += downloadBytes;
    bucket.uploadBytes += uploadBytes;
    byDay.set(key, bucket);
  }

  if (!hasDelta) return emptyPppoeHistory('Sem variação de consumo PPPoE recente.');

  const now = new Date();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(addDays(now, -1));
  const monthPrefix = todayKey.slice(0, 7);
  const monthBytes = { downloadBytes: 0, uploadBytes: 0 };

  for (const [key, value] of byDay.entries()) {
    if (key.startsWith(monthPrefix)) {
      monthBytes.downloadBytes += value.downloadBytes;
      monthBytes.uploadBytes += value.uploadBytes;
    }
  }

  const buildSeries = (days) => Array.from({ length: days }, (_, index) => {
    const key = dayKey(addDays(now, index - (days - 1)));
    const value = byDay.get(key) || { downloadBytes: 0, uploadBytes: 0 };
    return { date: key, ...usageBucket(value.downloadBytes, value.uploadBytes) };
  });

  return {
    today: usageBucket(byDay.get(todayKey)?.downloadBytes || 0, byDay.get(todayKey)?.uploadBytes || 0),
    yesterday: usageBucket(byDay.get(yesterdayKey)?.downloadBytes || 0, byDay.get(yesterdayKey)?.uploadBytes || 0),
    month: usageBucket(monthBytes.downloadBytes, monthBytes.uploadBytes),
    series7d: buildSeries(7),
    series30d: buildSeries(30),
    source: 'snapshot',
    message: '',
  };
};

exports.listInvoices = async (tenantId, clientId, query = {}) => {
  const { tid, cid } = await loadContext(tenantId, clientId);
  const filter = { tenantId: tid, clientId: cid };
  if (query.status) filter.status = trim(query.status, 40);
  const invoices = await Invoice.find(filter).sort({ dueDate: -1 }).limit(limitFromQuery(query)).lean();
  const billingMap = await billingByInvoiceIds(tid, invoices.map((i) => i._id));
  return invoices.map((inv) => invoiceSummary(inv, billingMap.get(String(inv._id))));
};

exports.getInvoicePayment = async (tenantId, clientId, invoiceId) => {
  const { tid, cid } = await loadContext(tenantId, clientId);
  const invoice = await Invoice.findOne({ _id: oid(invoiceId), tenantId: tid, clientId: cid }).lean();
  if (!invoice) throw ApiError.notFound('Fatura nao encontrada');
  const billing = await BillingInvoice.findOne({ tenantId: tid, invoiceId: invoice._id }).sort({ updatedAt: -1 }).lean();
  return {
    invoice: invoiceSummary(invoice, billing),
    payment: safeBillingInvoiceForPayment(billing),
    canIssueNewCharge: false,
  };
};

function protocolFor(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `XP${y}${m}${d}${rand}`;
}

function safeTicket(ticket) {
  return {
    _id: String(ticket._id),
    protocol: ticket.protocol,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

exports.createSupportTicket = async (tenantId, clientId, data = {}) => {
  const { tid, cid } = await loadContext(tenantId, clientId);
  const subject = trim(data.subject, 160);
  const message = trim(data.message, 4000);
  if (!subject) throw ApiError.badRequest('subject e obrigatorio');
  if (!message) throw ApiError.badRequest('message e obrigatorio');

  let protocol = protocolFor();
  for (let i = 0; i < 3; i += 1) {
    const exists = await SupportTicket.findOne({ protocol }).select('_id').lean();
    if (!exists) break;
    protocol = protocolFor();
  }

  const created = await SupportTicket.create({ tenantId: tid, clientId: cid, subject, message, protocol });
  return safeTicket(created.toObject());
};

exports.listSupportTickets = async (tenantId, clientId, query = {}) => {
  const { tid, cid } = await loadContext(tenantId, clientId);
  const filter = { tenantId: tid, clientId: cid };
  if (query.status) filter.status = trim(query.status, 40);
  const rows = await SupportTicket.find(filter).sort({ createdAt: -1 }).limit(limitFromQuery(query)).lean();
  return rows.map(safeTicket);
};

exports.getSupportTicket = async (tenantId, clientId, id) => {
  const { tid, cid } = await loadContext(tenantId, clientId);
  const ticket = await SupportTicket.findOne({ _id: oid(id), tenantId: tid, clientId: cid }).lean();
  if (!ticket) throw ApiError.notFound('Protocolo nao encontrado');
  return safeTicket(ticket);
};
