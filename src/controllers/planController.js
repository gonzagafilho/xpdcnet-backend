const planService = require('../services/planService');

exports.create = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const plan = await planService.create(tenantId, req.body);
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const plans = await planService.list(tenantId);
    res.json(plans);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const plan = await planService.getById(tenantId, req.params.id);
    res.json(plan);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const plan = await planService.update(tenantId, req.params.id, req.body);
    res.json(plan);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    await planService.remove(tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
