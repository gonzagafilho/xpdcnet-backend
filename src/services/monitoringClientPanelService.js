const mongoose = require('mongoose');
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
 * Resumo leve para o painel de monitoramento (evita GET /monitoring/session-board só para uma ficha).
 * GET /monitoring/client/:id
 *
 * @param {string} tenantId
 * @param {string} clientId
 * @param {{ timeoutMs?: string|number }} [query]
 */
exports.getClientMonitoringSummary = async (tenantId, clientId, query = {}) => {
  let timeoutMs = 12_000;
  if (query.timeoutMs != null && String(query.timeoutMs).trim() !== '') {
    const n = Number(query.timeoutMs);
    if (Number.isFinite(n)) timeoutMs = Math.min(120_000, Math.max(3_000, n));
  }

  const tid = mongoose.Types.ObjectId.isValid(String(tenantId)) ? new mongoose.Types.ObjectId(String(tenantId)) : null;
  if (!tid) throw ApiError.badRequest('Tenant inválido');

  const cid = String(clientId).trim();
  if (!mongoose.Types.ObjectId.isValid(cid)) throw ApiError.badRequest('Cliente inválido');

  const client = await Client.findOne({ _id: cid, tenantId: tid })
    .populate('planId', 'name speedMbps price authType mikrotik')
    .select('fullName status access mikrotik networkAccess')
    .lean();

  if (!client) return null;

  const authType = client.access && client.access.authType ? String(client.access.authType) : 'pppoe';
  const username = client.access && client.access.username ? String(client.access.username).trim() : '';
  const plan = client.planId;
  const planName = plan && plan.name ? String(plan.name) : null;

  const naIp = client.networkAccess && client.networkAccess.ip != null ? String(client.networkAccess.ip).trim() : '';

  const serverOid = client.mikrotik && client.mikrotik.serverId != null ? client.mikrotik.serverId : null;
  const serverIdStr = serverOid != null ? String(serverOid) : null;

  let serverName = null;
  if (serverIdStr && mongoose.Types.ObjectId.isValid(serverIdStr)) {
    const srv = await MikrotikServer.findOne({ _id: serverIdStr, tenantId: tid }).select('name').lean();
    serverName = srv && srv.name ? String(srv.name) : null;
  }

  if (!serverIdStr || !mongoose.Types.ObjectId.isValid(serverIdStr)) {
    return {
      generatedAt: new Date().toISOString(),
      clientId: cid,
      fullName: client.fullName || '',
      status: client.status || '',
      ip: naIp || null,
      login: username || null,
      authType,
      pppStatus: 'sem_servidor',
      activeConnection: null,
      serverId: null,
      serverName: null,
      equipmentOnline: false,
      equipmentLastError: null,
      planName,
      planRateLabel: planRateLabel(plan),
    };
  }

  let detail = null;
  try {
    detail = await mikrotikServerMonitoringService.getServerMonitoringDetail(String(tenantId), serverIdStr, {
      timeoutMs,
    });
  } catch (err) {
    detail = {
      online: false,
      generatedAt: new Date().toISOString(),
      lastError: err && err.message ? String(err.message) : 'Erro ao consultar equipamento.',
      activePppSessions: [],
      activePppSessionsTotal: 0,
    };
  }

  const sessionByUser = new Map();
  const sessions = detail && Array.isArray(detail.activePppSessions) ? detail.activePppSessions : [];
  for (const row of sessions) {
    const n = row.name != null ? String(row.name).trim().toLowerCase() : '';
    if (n) sessionByUser.set(n, row);
  }

  const serverOnline = Boolean(detail && detail.online);
  let pppStatus = 'sem_sessao';
  if (authType !== 'pppoe') pppStatus = 'nao_pppoe';
  else if (!serverOnline) pppStatus = 'equipamento_indisponivel';
  else {
    const sessLookup = username ? sessionByUser.get(username.toLowerCase()) : null;
    pppStatus = sessLookup ? 'online' : 'sem_sessao';
  }

  const sess =
    username && serverOnline && authType === 'pppoe' ? sessionByUser.get(username.toLowerCase()) : null;

  const ipSession = sess && sess.address != null ? String(sess.address).trim() : '';
  const ip = ipSession || naIp || null;

  return {
    generatedAt: (detail && detail.generatedAt) || new Date().toISOString(),
    clientId: cid,
    fullName: client.fullName || '',
    status: client.status || '',
    ip: ip || null,
    login: username || null,
    authType,
    pppStatus,
    activeConnection: sess
      ? {
          uptime: sess.uptime != null ? String(sess.uptime) : null,
          address: sess.address != null ? String(sess.address) : null,
          profile: sess.profile != null ? String(sess.profile) : null,
          service: sess.service != null ? String(sess.service) : null,
        }
      : null,
    serverId: serverIdStr,
    serverName,
    equipmentOnline: serverOnline,
    equipmentLastError: detail && detail.lastError ? String(detail.lastError) : null,
    planName,
    planRateLabel: planRateLabel(plan),
  };
};
