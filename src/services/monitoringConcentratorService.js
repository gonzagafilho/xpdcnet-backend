const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const MikrotikTelemetrySnapshot = require('../models/MikrotikTelemetrySnapshot');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');
const { evaluateConcentratorAlerts } = require('./concentratorAlertService');

const TELEMETRY_STALE_MS = 10 * 60 * 1000;

function objectId(value, field) {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest(`${field} inválido`);
  return new mongoose.Types.ObjectId(String(value));
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function healthScore({ status, cpuPercent, memoryPercent, interfaceTotal, interfaceRunning, pppOnline, telemetryAt }) {
  if (status && status !== 'online') return 0;
  let score = 100;
  const telemetryTime = telemetryAt ? new Date(telemetryAt).getTime() : Number.NaN;
  if (!Number.isFinite(telemetryTime) || Date.now() - telemetryTime > TELEMETRY_STALE_MS) score -= 25;
  if (cpuPercent > 80) score -= 20;
  if (memoryPercent > 90) score -= 20;
  if (interfaceTotal > 0 && interfaceRunning / interfaceTotal < 0.9) score -= 15;
  if (pppOnline <= 0) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function healthLabel(score) {
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'warning';
  if (score >= 40) return 'degraded';
  return 'critical';
}

function telemetryMatches(snapshot, concentrator) {
  if (!snapshot) return false;
  const id = String(concentrator._id);
  return String(snapshot.serverId || '') === id
    || String(snapshot.serverName || '') === String(concentrator.name || '')
    || String(snapshot.metadata?.concentratorId || '') === id
    || String(snapshot.metadata?.concentratorName || '') === String(concentrator.name || '');
}

function mapSummary(concentrator, telemetry, pppCounts = {}) {
  const cpuPercent = numberOrZero(telemetry?.cpuPercent);
  const memoryPercent = numberOrZero(telemetry?.memoryPercent);
  const interfaceTotal = numberOrZero(telemetry?.interfaceTotal ?? telemetry?.interfaces?.length);
  const interfaceRunning = numberOrZero(telemetry?.interfaceRunning ?? telemetry?.interfaces?.filter((item) => item.running && !item.disabled).length);
  const pppOnline = numberOrZero(pppCounts.online ?? telemetry?.pppOnline);
  const pppOffline = numberOrZero(pppCounts.offline);
  const pppUnknown = numberOrZero(pppCounts.unknown);
  const score = healthScore({ status: concentrator.status, cpuPercent, memoryPercent, interfaceTotal, interfaceRunning, pppOnline, telemetryAt: telemetry?.createdAt });

  return {
    id: String(concentrator._id),
    name: concentrator.name,
    type: concentrator.type,
    protocol: concentrator.protocol,
    host: concentrator.host,
    port: concentrator.port,
    enabled: Boolean(concentrator.enabled),
    status: concentrator.status || 'unknown',
    lastTestAt: concentrator.lastTestAt || null,
    lastErrorSafe: concentrator.lastErrorSafe || '',
    cpuPercent,
    memoryPercent,
    pppOnline,
    pppOffline,
    pppUnknown,
    pppTotal: pppOnline + pppOffline + pppUnknown,
    interfaceRunning,
    interfaceTotal,
    version: telemetry?.version || telemetry?.metadata?.version || '',
    uptime: telemetry?.uptime || telemetry?.metadata?.uptime || '',
    boardName: telemetry?.boardName || '',
    architectureName: telemetry?.architectureName || '',
    telemetryAt: telemetry?.createdAt || null,
    healthScore: score,
    health: healthLabel(score),
  };
}

async function loadContext(tenantId) {
  const tid = objectId(tenantId, 'tenantId');
  const concentrators = await NetworkConcentrator.find({ tenantId: tid }).select('-passwordEncrypted -username').sort({ enabled: -1, name: 1 }).lean();
  const ids = concentrators.map((row) => row._id);
  const names = concentrators.map((row) => row.name).filter(Boolean);
  const [telemetryRows, pppRows] = await Promise.all([
    ids.length ? MikrotikTelemetrySnapshot.find({
      tenantId: tid,
      $or: [
        { serverId: { $in: ids } },
        { serverName: { $in: names } },
        { 'metadata.concentratorId': { $in: ids.map(String) } },
        { 'metadata.concentratorName': { $in: names } },
      ],
    }).sort({ createdAt: -1 }).lean() : [],
    ids.length ? PppoeLiveSnapshot.aggregate([
      { $match: { tenantId: String(tid), concentratorId: { $in: ids } } },
      { $group: { _id: { concentratorId: '$concentratorId', status: '$status' }, total: { $sum: 1 } } },
    ]) : [],
  ]);
  const telemetryById = new Map();
  for (const concentrator of concentrators) {
    const latest = telemetryRows.find((row) => telemetryMatches(row, concentrator));
    if (latest) telemetryById.set(String(concentrator._id), latest);
  }
  const pppById = new Map();
  for (const row of pppRows) {
    const id = String(row._id.concentratorId);
    const counts = pppById.get(id) || {};
    counts[String(row._id.status || 'unknown')] = Number(row.total || 0);
    pppById.set(id, counts);
  }
  return { tid, concentrators, telemetryById, pppById };
}

exports.list = async (tenantId) => {
  const context = await loadContext(tenantId);
  const items = await Promise.all(context.concentrators.map(async (row) => {
    const item = mapSummary(
      row,
      context.telemetryById.get(String(row._id)),
      context.pppById.get(String(row._id)),
    );
    const alertSummary = await evaluateConcentratorAlerts(context.tid, item);
    return {
      ...item,
      openAlerts: alertSummary.openAlerts,
      criticalAlerts: alertSummary.criticalAlerts,
      warningAlerts: alertSummary.warningAlerts,
    };
  }));
  const totals = items.reduce((result, item) => {
    result.total += 1;
    if (item.status === 'online') result.online += 1;
    else if (item.status === 'offline') result.offline += 1;
    else result.unknown += 1;
    result.pppOnline += item.pppOnline;
    result.pppTotal += item.pppTotal;
    result.interfaceRunning += item.interfaceRunning;
    result.interfaceTotal += item.interfaceTotal;
    result.openAlerts += item.openAlerts;
    result.criticalAlerts += item.criticalAlerts;
    result.warningAlerts += item.warningAlerts;
    if (item.health === 'critical') result.critical += 1;
    if (item.health === 'warning' || item.health === 'degraded') result.warning += 1;
    return result;
  }, {
    total: 0,
    online: 0,
    offline: 0,
    unknown: 0,
    warning: 0,
    critical: 0,
    pppOnline: 0,
    pppTotal: 0,
    interfaceRunning: 0,
    interfaceTotal: 0,
    openAlerts: 0,
    criticalAlerts: 0,
    warningAlerts: 0,
  });
  return { ok: true, generatedAt: new Date().toISOString(), ...totals, items };
};

exports.detail = async (tenantId, concentratorId) => {
  const tid = objectId(tenantId, 'tenantId');
  const cid = objectId(concentratorId, 'concentratorId');
  const concentrator = await NetworkConcentrator.findOne({ _id: cid, tenantId: tid }).select('-passwordEncrypted -username').lean();
  if (!concentrator) throw ApiError.notFound('Concentrador não encontrado');
  const [history, pppRows] = await Promise.all([
    MikrotikTelemetrySnapshot.find({
      tenantId: tid,
      $or: [{ serverId: cid }, { serverName: concentrator.name }, { 'metadata.concentratorId': String(cid) }, { 'metadata.concentratorName': concentrator.name }],
    }).sort({ createdAt: -1 }).limit(24).lean(),
    PppoeLiveSnapshot.aggregate([
      { $match: { tenantId: String(tid), concentratorId: cid } },
      { $group: { _id: '$status', total: { $sum: 1 } } },
    ]),
  ]);
  const pppCounts = Object.fromEntries(pppRows.map((row) => [String(row._id || 'unknown'), Number(row.total || 0)]));
  const item = mapSummary(concentrator, history[0] || null, pppCounts);
  const alertSummary = await evaluateConcentratorAlerts(tid, item);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    item: {
      ...item,
      openAlerts: alertSummary.openAlerts,
      criticalAlerts: alertSummary.criticalAlerts,
      warningAlerts: alertSummary.warningAlerts,
    },
    telemetryHistory: history.map((row) => ({
      createdAt: row.createdAt,
      cpuPercent: numberOrZero(row.cpuPercent),
      memoryPercent: numberOrZero(row.memoryPercent),
      pppOnline: numberOrZero(row.pppOnline),
      interfaceRunning: numberOrZero(row.interfaceRunning),
      interfaceTotal: numberOrZero(row.interfaceTotal ?? row.interfaces?.length),
      health: row.health || 'healthy',
    })),
  };
};

exports._private = { healthScore, healthLabel, mapSummary };
