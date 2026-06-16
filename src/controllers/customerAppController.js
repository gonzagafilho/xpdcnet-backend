const customerAppService = require('../services/customerAppService');

function tenantId(req) {
  return req.customer.tenantId;
}

function clientId(req) {
  return req.customer.clientId;
}

exports.getMe = async (req, res, next) => {
  try {
    res.json(await customerAppService.getDashboard(tenantId(req), clientId(req)));
  } catch (err) {
    next(err);
  }
};

exports.getPlan = async (req, res, next) => {
  try {
    res.json(await customerAppService.getPlan(tenantId(req), clientId(req)));
  } catch (err) {
    next(err);
  }
};

exports.getConnection = async (req, res, next) => {
  try {
    res.json(await customerAppService.getConnection(tenantId(req), clientId(req)));
  } catch (err) {
    next(err);
  }
};

exports.listInvoices = async (req, res, next) => {
  try {
    res.json({ items: await customerAppService.listInvoices(tenantId(req), clientId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.getInvoicePayment = async (req, res, next) => {
  try {
    res.json(await customerAppService.getInvoicePayment(tenantId(req), clientId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.createSupportTicket = async (req, res, next) => {
  try {
    res.status(201).json(await customerAppService.createSupportTicket(tenantId(req), clientId(req), req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.listSupportTickets = async (req, res, next) => {
  try {
    res.json({ items: await customerAppService.listSupportTickets(tenantId(req), clientId(req), req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.getSupportTicket = async (req, res, next) => {
  try {
    res.json(await customerAppService.getSupportTicket(tenantId(req), clientId(req), req.params.id));
  } catch (err) {
    next(err);
  }
};
