const mongoose = require('mongoose');
const ApiError = require('../../errors/ApiError');
const BillingAccount = require('../../models/billing/BillingAccount');
const billingService = require('../../services/billing/billingService');

exports.listAdapters = async (req, res, next) => {
  try {
    res.json({ adapters: billingService.listAvailableAdapters() });
  } catch (err) {
    next(err);
  }
};

exports.listProviders = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await billingService.listProviders(tenantId));
  } catch (err) {
    next(err);
  }
};

exports.createProvider = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.status(201).json(await billingService.createProvider(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.listAccounts = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await billingService.listAccounts(tenantId));
  } catch (err) {
    next(err);
  }
};

exports.createAccount = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.status(201).json(await billingService.createAccount(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
};

exports.getPolicy = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await billingService.getPolicy(tenantId));
  } catch (err) {
    next(err);
  }
};

exports.updatePolicy = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    res.json(await billingService.updatePolicy(tenantId, req.body || {}, req.user || null));
  } catch (err) {
    next(err);
  }
};

exports.issueFromInvoice = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const body = { ...(req.body || {}) };
    if (req.user && req.user.email) body.userEmail = String(req.user.email);
    res.status(201).json(await billingService.issueChargeFromInvoice(tenantId, req.params.invoiceId, body));
  } catch (err) {
    next(err);
  }
};

/**
 * Webhook provider: sem JWT. Tenant inferido pela BillingAccount (ObjectId global).
 * Resposta genérica para não vazar estado interno a terceiros.
 */
exports.receiveWebhook = async (req, res, next) => {
  try {
    const accountId = req.params.billingAccountId;
    if (!mongoose.Types.ObjectId.isValid(String(accountId))) {
      return next(ApiError.notFound('Conta não encontrada'));
    }
    const acc = await BillingAccount.findById(accountId).select('tenantId').lean();
    if (!acc) {
      return next(ApiError.notFound('Conta não encontrada'));
    }
    const tenantId = String(acc.tenantId);
    const fp = billingService.computeWebhookRequestFingerprint(req.headers || {}, req.body || {});
    const xf = req.headers && req.headers['x-forwarded-for'];
    const sourceIp = String(xf || req.socket.remoteAddress || '')
      .split(',')[0]
      .trim();
    await billingService.receiveWebhook(tenantId, accountId, req.body || {}, req.headers || {}, {
      requestFingerprint: fp,
      sourceIp,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.syncBillingInvoice = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const payload = await billingService.syncBillingInvoiceFromProvider(tenantId, req.params.id, req.user || null);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};
