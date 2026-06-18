const PaymentGatewayTransaction = require('../../models/billing/PaymentGatewayTransaction');
const mercadoPagoPixService = require('../../services/billing/mercadoPagoPixService');

async function createMercadoPagoBolepix(req, res) {
  try {
    const { invoiceId } = req.params;

    const tx = await mercadoPagoPixService.createPixForInvoice(invoiceId);

    return res.json({
      ok: true,
      gateway: 'mercadopago',
      transaction: tx,
    });
  } catch (err) {
    console.error('[bolepix:createMercadoPagoBolepix]', err);
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}

async function getTransactionByInvoice(req, res) {
  try {
    const { invoiceId } = req.params;

    const tx = await PaymentGatewayTransaction.findOne({
      invoiceId,
      gateway: req.query.gateway || 'mercadopago',
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      transaction: tx,
    });
  } catch (err) {
    console.error('[bolepix:getTransactionByInvoice]', err);
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}

async function mercadoPagoWebhook(req, res) {
  try {
    const result = await mercadoPagoPixService.handleWebhook(req.body || {});

    return res.json({
      ok: true,
      result,
    });
  } catch (err) {
    console.error('[bolepix:mercadoPagoWebhook]', err);

    return res.status(200).json({
      ok: false,
      error: err.message,
    });
  }
}

async function reconcileMercadoPago(req, res) {
  try {
    const limit = Number(req.query.limit || 50);
    const results = await mercadoPagoPixService.reconcilePendingPayments(limit);

    return res.json({
      ok: true,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error('[bolepix:reconcileMercadoPago]', err);
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}

module.exports = {
  createMercadoPagoBolepix,
  getTransactionByInvoice,
  mercadoPagoWebhook,
  reconcileMercadoPago,
};
