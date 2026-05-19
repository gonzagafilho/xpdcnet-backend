const ApiError = require('../errors/ApiError');
const monitoringSessionBoardService = require('../services/monitoringSessionBoardService');
const monitoringClientPanelService = require('../services/monitoringClientPanelService');

/** GET /monitoring/client/:id */
exports.getClientMonitoring = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const row = await monitoringClientPanelService.getClientMonitoringSummary(tenantId, req.params.id, req.query || {});
    if (!row) throw ApiError.notFound('Cliente não encontrado');
    res.json(row);
  } catch (err) {
    next(err);
  }
};

/** GET /monitoring/session-board */
exports.getSessionBoard = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await monitoringSessionBoardService.getSessionBoard(tenantId, req.query || {});
    res.json(payload);
  } catch (err) {
    next(err);
  }
};
