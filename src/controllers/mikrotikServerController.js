const ApiError = require('../errors/ApiError');
const mikrotikServerService = require('../services/mikrotikServerService');
const mikrotikServerMonitoringService = require('../services/mikrotikServerMonitoringService');

exports.create = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const server = await mikrotikServerService.createServer(tenantId, req.body);
    res.status(201).json(server);
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const servers = await mikrotikServerService.listServers(tenantId);
    res.json(servers);
  } catch (err) {
    next(err);
  }
};

exports.monitoringSnapshot = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    let timeoutMs;
    if (req.query.timeoutMs != null && req.query.timeoutMs !== '') {
      const n = Number(req.query.timeoutMs);
      if (Number.isFinite(n)) timeoutMs = n;
    }
    const payload = await mikrotikServerMonitoringService.listServersWithMonitoring(tenantId, { timeoutMs });
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.serverMonitoringDetail = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    let timeoutMs;
    if (req.query.timeoutMs != null && req.query.timeoutMs !== '') {
      const n = Number(req.query.timeoutMs);
      if (Number.isFinite(n)) timeoutMs = n;
    }
    const payload = await mikrotikServerMonitoringService.getServerMonitoringDetail(tenantId, req.params.id, {
      timeoutMs,
    });
    if (!payload) throw ApiError.notFound('Servidor MikroTik não encontrado');
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const server = await mikrotikServerService.getServer(tenantId, req.params.id);
    res.json(server);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const server = await mikrotikServerService.updateServer(tenantId, req.params.id, req.body);
    res.json(server);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    await mikrotikServerService.deleteServer(tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
