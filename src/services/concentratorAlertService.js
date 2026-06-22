const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const ConcentratorAlert = require('../models/ConcentratorAlert');

const TELEMETRY_STALE_MS = 10 * 60 * 1000;
const ALERT_TYPES = ['CPU_HIGH', 'RAM_HIGH', 'PPP_DROP', 'OFFLINE', 'TELEMETRY_STALE'];
const EVALUATED_TYPES = ['CPU_HIGH', 'RAM_HIGH', 'OFFLINE', 'TELEMETRY_STALE'];

function objectId(value, field) {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest(`${field} inválido`);
  return new mongoose.Types.ObjectId(String(value));
}

function evaluateConditions(summary, now = new Date()) {
  const cpu = Number(summary.cpuPercent);
  const memory = Number(summary.memoryPercent);
  const telemetryTime = summary.telemetryAt ? new Date(summary.telemetryAt).getTime() : Number.NaN;
  const telemetryAgeMs = Number.isFinite(telemetryTime) ? now.getTime() - telemetryTime : null;

  return {
    CPU_HIGH: Number.isFinite(cpu) && cpu > 80
      ? {
        severity: cpu > 90 ? 'critical' : 'warning',
        title: 'CPU elevada no concentrador',
        description: `${summary.name} está com CPU em ${cpu}%.`,
        metricValue: cpu,
        thresholdValue: cpu > 90 ? 90 : 80,
      }
      : null,
    RAM_HIGH: Number.isFinite(memory) && memory > 90
      ? {
        severity: 'critical',
        title: 'Memória elevada no concentrador',
        description: `${summary.name} está com RAM em ${memory}%.`,
        metricValue: memory,
        thresholdValue: 90,
      }
      : null,
    OFFLINE: summary.status !== 'online'
      ? {
        severity: 'critical',
        title: 'Concentrador offline',
        description: `${summary.name} está com status ${summary.status || 'desconhecido'}.`,
        metricValue: summary.status || 'unknown',
        thresholdValue: 'online',
      }
      : null,
    TELEMETRY_STALE: telemetryAgeMs === null || telemetryAgeMs > TELEMETRY_STALE_MS
      ? {
        severity: 'critical',
        title: 'Telemetria desatualizada',
        description: telemetryAgeMs === null
          ? `${summary.name} não possui telemetria registrada.`
          : `${summary.name} está sem telemetria atualizada há ${Math.floor(telemetryAgeMs / 60_000)} minutos.`,
        metricValue: telemetryAgeMs === null ? null : Math.floor(telemetryAgeMs / 60_000),
        thresholdValue: 10,
      }
      : null,
    PPP_DROP: null,
  };
}

function createService(AlertModel = ConcentratorAlert) {
  async function evaluateConcentratorAlerts(tenantId, concentratorSummary, options = {}) {
    const tid = objectId(tenantId, 'tenantId');
    const cid = objectId(concentratorSummary.id, 'concentratorId');
    const now = options.now || new Date();
    const conditions = evaluateConditions(concentratorSummary, now);

    await Promise.all(EVALUATED_TYPES.map(async (type) => {
      const condition = conditions[type];
      const filter = {
        tenantId: tid,
        concentratorId: cid,
        type,
        status: 'open',
      };
      if (!condition) {
        await AlertModel.updateMany(filter, {
          $set: { status: 'resolved', resolvedAt: now },
        });
        return;
      }
      const update = {
        $set: {
          concentratorName: concentratorSummary.name,
          severity: condition.severity,
          title: condition.title,
          description: condition.description,
          metricValue: condition.metricValue,
          thresholdValue: condition.thresholdValue,
          resolvedAt: null,
          metadata: {
            telemetryAt: concentratorSummary.telemetryAt || null,
            healthScore: concentratorSummary.healthScore,
          },
        },
        $setOnInsert: {
          tenantId: tid,
          concentratorId: cid,
          type,
          status: 'open',
          openedAt: now,
        },
      };
      try {
        await AlertModel.findOneAndUpdate(
          filter,
          update,
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      } catch (err) {
        if (err?.code !== 11000) throw err;
        await AlertModel.findOneAndUpdate(filter, { $set: update.$set }, { new: true });
      }
    }));

    const openAlerts = await AlertModel.find({
      tenantId: tid,
      concentratorId: cid,
      status: 'open',
    }).sort({ severity: 1, openedAt: -1 }).lean();

    return {
      alerts: openAlerts,
      openAlerts: openAlerts.length,
      criticalAlerts: openAlerts.filter((row) => row.severity === 'critical').length,
      warningAlerts: openAlerts.filter((row) => row.severity === 'warning').length,
    };
  }

  async function listConcentratorAlerts(tenantId, query = {}) {
    const filter = { tenantId: objectId(tenantId, 'tenantId') };
    if (query.status && ['open', 'resolved'].includes(query.status)) filter.status = query.status;
    if (query.severity && ['warning', 'critical'].includes(query.severity)) filter.severity = query.severity;
    if (query.type && ALERT_TYPES.includes(query.type)) filter.type = query.type;
    if (query.concentratorId) filter.concentratorId = objectId(query.concentratorId, 'concentratorId');
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const items = await AlertModel.find(filter).sort({ openedAt: -1 }).limit(limit).lean();
    return { ok: true, total: items.length, items };
  }

  async function resolveConcentratorAlert(tenantId, alertId) {
    const row = await AlertModel.findOneAndUpdate(
      {
        _id: objectId(alertId, 'alertId'),
        tenantId: objectId(tenantId, 'tenantId'),
      },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
        },
      },
      { new: true },
    ).lean();
    if (!row) throw ApiError.notFound('Alerta não encontrado');
    return row;
  }

  return {
    evaluateConcentratorAlerts,
    listConcentratorAlerts,
    resolveConcentratorAlert,
  };
}

module.exports = {
  ...createService(),
  _private: {
    ALERT_TYPES,
    EVALUATED_TYPES,
    TELEMETRY_STALE_MS,
    createService,
    evaluateConditions,
  },
};
