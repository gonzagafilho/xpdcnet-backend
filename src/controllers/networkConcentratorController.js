const networkConcentratorService = require('../services/networkConcentratorService');

function getAuthContext(req) {
  return {
    tenantId: req.tenant?._id?.toString(),
    userId: req.user?.id || null,
  };
}

exports.list = async (req, res, next) => {
  try {
    const items = await networkConcentratorService.listNetworkConcentrators(getAuthContext(req));
    res.json(Array.isArray(items) ? items : []);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const created = await networkConcentratorService.createNetworkConcentrator(
      req.body || {},
      getAuthContext(req),
    );
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const updated = await networkConcentratorService.updateNetworkConcentrator(
      req.params.id,
      req.body || {},
      getAuthContext(req),
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await networkConcentratorService.deleteNetworkConcentrator(
      req.params.id,
      getAuthContext(req),
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

exports.testConnection = async (req, res, next) => {
  try {
    const out = await networkConcentratorService.testNetworkConcentrator(
      req.params.id,
      getAuthContext(req),
    );
    res.status(202).json(out);
  } catch (err) {
    next(err);
  }
};
