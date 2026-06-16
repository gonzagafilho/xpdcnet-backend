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
