const clientService = require('../services/clientService');

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

exports.getById = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const client = await clientService.getById(tenantId, req.params.id);
    res.json(client);
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
