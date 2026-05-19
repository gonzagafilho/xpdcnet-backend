const operationsReadService = require('../../services/operations/operationsReadService');
const operationLogService = require('../../services/operationLogService');

exports.executiveDashboard = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await operationsReadService.getExecutiveDashboard(tenantId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.clientTimeline = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const clientId = req.params.id;
    const payload = await operationsReadService.getClientTimeline(tenantId, clientId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

/** GET /operations/logs — auditoria operacional paginada (NOC). */
exports.listOperationLogs = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await operationLogService.listPaginated(tenantId, req.query);
    res.json({
      ...payload,
      tenantSlug: req.tenant.slug,
    });
  } catch (err) {
    next(err);
  }
};
