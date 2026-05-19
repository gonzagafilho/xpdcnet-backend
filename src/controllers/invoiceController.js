const invoiceService = require('../services/invoiceService');

exports.create = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const invoice = await invoiceService.create(tenantId, req.body);
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const invoices = await invoiceService.list(tenantId, req.query);
    res.json(invoices);
  } catch (err) {
    next(err);
  }
};

exports.summary = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const data = await invoiceService.summary(tenantId, req.query);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.financePolicyImpact = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const data = await invoiceService.financePolicyImpact(tenantId, req.query);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const invoice = await invoiceService.getById(tenantId, req.params.id);
    res.json(invoice);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const invoice = await invoiceService.update(tenantId, req.params.id, req.body);
    res.json(invoice);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    await invoiceService.remove(tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

exports.generateMonth = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const summary = await invoiceService.generateMonth(tenantId, req.body);
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
};
