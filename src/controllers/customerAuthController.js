const customerAuthService = require('../services/customerAuthService');

exports.login = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await customerAuthService.login(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    res.json(await customerAuthService.me(req.customer.client));
  } catch (err) {
    next(err);
  }
};
