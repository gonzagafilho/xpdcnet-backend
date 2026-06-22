const clientService = require('../services/clientService');
const clientAccessService = require('../services/clientAccessService');
const clientOperationalService = require('../services/clientOperationalService');

exports.create = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const client = await clientService.create(tenantId, req.body);
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const clients = await clientService.list(tenantId, req.query);
    res.json(clients);
  } catch (err) {
    next(err);
  }
};

exports.summary = async (req, res, next) => {
  try {
    res.json(await clientOperationalService.summary(req.tenant._id.toString()));
  } catch (err) {
    next(err);
  }
};

exports.exportCsv = async (req, res, next) => {
  try {
    const result = await clientOperationalService.exportCsv(req.tenant._id.toString(), req.query || {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
    res.status(200).send(result.content);
  } catch (err) {
    next(err);
  }
};

exports.operationalDetails = async (req, res, next) => {
  try {
    res.json(await clientOperationalService.details(req.tenant._id.toString(), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const client = await clientService.getById(tenantId, req.params.id);
    res.json(client);
  } catch (err) {
    next(err);
  }
};

exports.listAccesses = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json({ items: await clientAccessService.listByClient(tenantId, req.params.id) });
  } catch (err) {
    next(err);
  }
};

/** GET .../network-intent — só política derivada do cadastro; não executa sync nem RouterOS. */
exports.getNetworkIntent = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await clientService.getNetworkIntent(tenantId, req.params.id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const client = await clientService.update(tenantId, req.params.id, req.body);
    res.json(client);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    await clientService.remove(tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
