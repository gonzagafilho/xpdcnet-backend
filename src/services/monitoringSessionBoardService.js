const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const MikrotikServer = require('../models/MikrotikServer');
const mikrotikServerMonitoringService = require('./mikrotikServerMonitoringService');

function planRateLabel(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const mk = plan.mikrotik && plan.mikrotik.rateLimit;
  if (mk != null && String(mk).trim()) return String(mk).trim();
  if (plan.speedMbps != null && Number.isFinite(Number(plan.speedMbps))) {
    return `até ${plan.speedMbps} Mbps (plano)`;
  }
  return null;
}

/**
 * Painel operacional: clientes cadastrados por servidor cruzados com /ppp/active (snapshot actual).
 * Um servidor em falha não cancela os restantes (Promise.all por lote).
 *
 * @param {string} tenantId
 * @param {{ serverId?: string, timeoutMs?: number|string }} query
 */
exports.getSessionBoard = async (tenantId, query = {}) => {
  const tid = mongoose.Types.ObjectId.isValid(String(tenantId)) ? new mongoose.Types.ObjectId(String(tenantId)) : null;
  if (!tid) throw ApiError.badRequest('Tenant inválido');

  let timeoutMs = 12_000;
  if (query.timeoutMs != null && String(query.timeoutMs).trim() !== '') {
    const n = Number(query.timeoutMs);
    if (Number.isFinite(n)) timeoutMs = Math.min(120_000, Math.max(3_000, n));
  }

  const filter = { tenantId: tid };
  if (query.serverId != null && String(query.serverId).trim() !== '') {
    const sid = String(query.serverId).trim();
    if (!mongoose.Types.ObjectId.isValid(sid)) throw ApiError.badRequest('serverId inválido');
    filter._id = new mongoose.Types.ObjectId(sid);
  }

  const servers = await MikrotikServer.find(filter).select('_id name host isActive').sort({ name: 1 }).lean();
  if (!servers.length) {
    return { generatedAt: new Date().toISOString(), servers: [] };
  }

  const serverOids = servers.map((s) => s._id);

  const clients = await Client.find({
    tenantId: tid,
    'mikrotik.serverId': { $in: serverOids },
  })
    .populate('planId', 'name speedMbps price authType mikrotik')
    .select('fullName status access mikrotik geo')
    .lean();

  const clientsByServer = new Map();
  for (const s of servers) {
    clientsByServer.set(String(s._id), []);
  }
  for (const c of clients) {
    const sid = c.mikrotik && c.mikrotik.serverId != null ? String(c.mikrotik.serverId) : '';
    if (!sid || !clientsByServer.has(sid)) continue;
    clientsByServer.get(sid).push(c);
  }

  const concurrency = Math.min(
    5,
    Math.max(1, Number.parseInt(String(process.env.MONITORING_BOARD_CONCURRENCY || '3'), 10) || 3),
  );

  async function buildForServer(s) {
    const sid = String(s._id);
    let detail = null;
    try {
      detail = await mikrotikServerMonitoringService.getServerMonitoringDetail(String(tenantId), sid, { timeoutMs });
    } catch (err) {
      detail = {
        online: false,
        lastError: err && err.message ? String(err.message) : 'Falha ao obter detalhe do servidor.',
        activePppSessions: [],
        activePppSessionsTotal: 0,
        monitoringChannel: null,
        cpuPercent: null,
        memoryFreeBytes: null,
        memoryTotalBytes: null,
        uptime: null,
        identityName: null,
      };
    }

    const sessionByUser = new Map();
    const sessions = detail && Array.isArray(detail.activePppSessions) ? detail.activePppSessions : [];
    for (const row of sessions) {
      const n = row.name != null ? String(row.name).trim().toLowerCase() : '';
      if (n) sessionByUser.set(n, row);
    }

    const serverOnline = Boolean(detail && detail.online);
    const list = clientsByServer.get(sid) || [];

    const rows = list.map((c) => {
      const authType = c.access && c.access.authType ? String(c.access.authType) : 'pppoe';
      const username = c.access && c.access.username ? String(c.access.username).trim() : '';
      const plan = c.planId;

      let pppStatus = 'sem_sessao';
      if (authType !== 'pppoe') pppStatus = 'nao_pppoe';
      else if (!serverOnline) pppStatus = 'equipamento_indisponivel';
      else {
        const sess = username ? sessionByUser.get(username.toLowerCase()) : null;
        pppStatus = sess ? 'online' : 'sem_sessao';
      }

      const sess =
        username && serverOnline && authType === 'pppoe' ? sessionByUser.get(username.toLowerCase()) : null;

      const geo =
        c.geo &&
        c.geo.lat != null &&
        c.geo.lng != null &&
        Number.isFinite(Number(c.geo.lat)) &&
        Number.isFinite(Number(c.geo.lng))
          ? { lat: Number(c.geo.lat), lng: Number(c.geo.lng) }
          : null;

      return {
        clientId: String(c._id),
        fullName: c.fullName,
        username,
        authType,
        status: c.status,
        planName: plan && plan.name ? String(plan.name) : null,
        planRateLabel: planRateLabel(plan),
        pppStatus,
        session: sess
          ? {
              address: sess.address != null ? String(sess.address) : null,
              uptime: sess.uptime != null ? String(sess.uptime) : null,
              profile: sess.profile != null ? String(sess.profile) : null,
              service: sess.service != null ? String(sess.service) : null,
            }
          : null,
        geo,
      };
    });

    const activeClients = rows.filter((r) => r.status === 'active').length;
    const pendingClients = rows.filter((r) => r.status === 'pending').length;
    const blockedish = rows.filter((r) =>
      ['blocked', 'suspended', 'delinquent', 'disabled'].includes(r.status),
    ).length;

    return {
      server: {
        id: sid,
        name: s.name,
        host: s.host,
        isActive: Boolean(s.isActive),
        online: serverOnline,
        lastError: detail && detail.lastError ? String(detail.lastError) : null,
        monitoringChannel: detail && detail.monitoringChannel != null ? String(detail.monitoringChannel) : null,
        cpuPercent: detail && detail.cpuPercent != null ? detail.cpuPercent : null,
        memoryFreeBytes: detail && detail.memoryFreeBytes != null ? detail.memoryFreeBytes : null,
        memoryTotalBytes: detail && detail.memoryTotalBytes != null ? detail.memoryTotalBytes : null,
        uptime: detail && detail.uptime != null ? String(detail.uptime) : null,
        identityName: detail && detail.identityName != null ? String(detail.identityName) : null,
        version: detail && detail.version != null ? String(detail.version) : null,
        board: detail && detail.board != null ? String(detail.board) : null,
      },
      summary: {
        totalClients: rows.length,
        pppOnline: rows.filter((r) => r.pppStatus === 'online').length,
        pppSemSessao: rows.filter((r) => r.pppStatus === 'sem_sessao').length,
        naoPppoe: rows.filter((r) => r.pppStatus === 'nao_pppoe').length,
        equipamentoIndisponivel: rows.filter((r) => r.pppStatus === 'equipamento_indisponivel').length,
        cadastroActive: activeClients,
        cadastroPending: pendingClients,
        cadastroBloqueadosOuSimilares: blockedish,
        pppActiveTotalRouter: detail && detail.activePppSessionsTotal != null ? detail.activePppSessionsTotal : 0,
      },
      rows,
    };
  }

  const outServers = [];
  for (let i = 0; i < servers.length; i += concurrency) {
    const slice = servers.slice(i, i + concurrency);
    const parts = await Promise.all(slice.map((s) => buildForServer(s)));
    outServers.push(...parts);
  }

  return { generatedAt: new Date().toISOString(), servers: outServers };
};
