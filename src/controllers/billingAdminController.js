const billingAdminService = require('../services/billingAdminService');

function tenantId(req) {
  return req.tenant._id.toString();
}

exports.listAdapters = async (req, res, next) => {
  try {
    res.json(await billingAdminService.listAdapters());
  } catch (err) {
    next(err);
  }
};

exports.listProviders = async (req, res, next) => {
  try {
    res.json({ items: await billingAdminService.listProviders(tenantId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.createProvider = async (req, res, next) => {
  try {
    res.status(201).json(await billingAdminService.createProvider(tenantId(req), req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.getProvider = async (req, res, next) => {
  try {
    res.json(await billingAdminService.getProvider(tenantId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.updateProvider = async (req, res, next) => {
  try {
    res.json(await billingAdminService.updateProvider(tenantId(req), req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.setProviderActive = async (req, res, next) => {
  try {
    res.json(await billingAdminService.setProviderActive(tenantId(req), req.params.id, req.body?.isActive !== false));
  } catch (err) {
    next(err);
  }
};

exports.listAccounts = async (req, res, next) => {
  try {
    res.json({ items: await billingAdminService.listAccounts(tenantId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.createAccount = async (req, res, next) => {
  try {
    res.status(201).json(await billingAdminService.createAccount(tenantId(req), req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.getAccount = async (req, res, next) => {
  try {
    res.json(await billingAdminService.getAccount(tenantId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.updateAccount = async (req, res, next) => {
  try {
    res.json(await billingAdminService.updateAccount(tenantId(req), req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.setAccountActive = async (req, res, next) => {
  try {
    res.json(await billingAdminService.setAccountActive(tenantId(req), req.params.id, req.body?.isActive !== false));
  } catch (err) {
    next(err);
  }
};

exports.setDefaultAccount = async (req, res, next) => {
  try {
    res.json(await billingAdminService.setDefaultAccount(tenantId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.listBillingInvoices = async (req, res, next) => {
  try {
    res.json({ items: await billingAdminService.listBillingInvoices(tenantId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.getBillingInvoice = async (req, res, next) => {
  try {
    res.json(await billingAdminService.getBillingInvoice(tenantId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.syncBillingInvoiceStatus = async (req, res, next) => {
  try {
    res.json(await billingAdminService.syncBillingInvoiceStatus(tenantId(req), req.params.id, req.user || null));
  } catch (err) {
    next(err);
  }
};

exports.cancelBillingInvoice = async (req, res, next) => {
  try {
    res.json(await billingAdminService.cancelBillingInvoice(tenantId(req), req.params.id, req.user || null));
  } catch (err) {
    next(err);
  }
};

exports.listWebhookEvents = async (req, res, next) => {
  try {
    res.json({ items: await billingAdminService.listWebhookEvents(tenantId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.listAuditLogs = async (req, res, next) => {
  try {
    res.json({ items: await billingAdminService.listAuditLogs(tenantId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};
