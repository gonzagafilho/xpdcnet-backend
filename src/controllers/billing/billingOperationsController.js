const billingOperationsReadService = require('../../services/billing/billingOperationsReadService');

exports.getSummary = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await billingOperationsReadService.getSummary(tenantId));
  } catch (err) {
    next(err);
  }
};

exports.listInvoices = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json({ items: await billingOperationsReadService.listBillingInvoices(tenantId, req.query || {}) });
  } catch (err) {
    next(err);
  }
};

exports.getInvoiceTimeline = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await billingOperationsReadService.getBillingInvoiceTimeline(tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
};
