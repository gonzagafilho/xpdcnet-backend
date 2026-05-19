const mikrotikMonitoringService = require('../services/mikrotikMonitoringService');
const operationLogService = require('../services/operationLogService');

exports.getClientMonitoring = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const clientId = req.params.id;
    let timeoutMs;
    if (req.query.timeoutMs != null && String(req.query.timeoutMs).trim() !== '') {
      const n = Number(req.query.timeoutMs);
      if (Number.isFinite(n)) {
        timeoutMs = Math.min(120_000, Math.max(3_000, n));
      }
    }
    const payload = await mikrotikMonitoringService.getClientMikrotikMonitoring(tenantId, clientId, {
      timeoutMs,
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.getDivergenceDashboard = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await mikrotikMonitoringService.getFinancePolicyDivergenceDashboard(tenantId, req.query || {});
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.reconcileClient = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const clientId = req.params.id;
    let timeoutMs;
    if (req.query.timeoutMs != null && String(req.query.timeoutMs).trim() !== '') {
      const n = Number(req.query.timeoutMs);
      if (Number.isFinite(n)) {
        timeoutMs = Math.min(120_000, Math.max(3_000, n));
      }
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = await mikrotikMonitoringService.reconcileClientDivergence(tenantId, clientId, {
      user: req.user || null,
      reason: body.reason,
      force: body.force === true,
      timeoutMs,
    });
    await operationLogService.logOperation({
      tenantId: req.tenant._id,
      userId: req.user && req.user.id ? req.user.id : null,
      action: 'mikrotik_monitoring.reconcile',
      targetType: 'Client',
      targetId: String(clientId),
      payload: { reason: body.reason, force: body.force === true },
      result: { ok: true },
      status: 'success',
      req,
    });
    res.status(201).json(payload);
  } catch (err) {
    await operationLogService.logOperation({
      tenantId: req.tenant._id,
      userId: req.user && req.user.id ? req.user.id : null,
      action: 'mikrotik_monitoring.reconcile',
      targetType: 'Client',
      targetId: String(req.params.id || ''),
      status: 'error',
      errorMessage: err && err.message ? String(err.message) : String(err),
      req,
    });
    next(err);
  }
};
