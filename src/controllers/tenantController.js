const tenantService = require('../services/tenantService');

exports.create = async (req, res, next) => {
  try {
    const tenant = await tenantService.createTenant(req.body);
    res.status(201).json(tenant);
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const tenants = await tenantService.listTenants();
    res.json(tenants);
  } catch (err) {
    next(err);
  }
};

exports.getFinancePolicy = async (req, res, next) => {
  try {
    const payload = await tenantService.getFinancePolicyForOperationalTenant(req.headers);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.updateFinancePolicy = async (req, res, next) => {
  try {
    const payload = await tenantService.updateFinancePolicyForOperationalTenant(req.headers, req.body, req.user || null);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};
