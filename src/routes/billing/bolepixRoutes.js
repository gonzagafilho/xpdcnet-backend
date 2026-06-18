const express = require('express');
const router = express.Router();

const bolepixController = require('../../controllers/billing/bolepixController');

router.post(
  '/invoices/:invoiceId/mercadopago/pix',
  bolepixController.createMercadoPagoBolepix
);

router.get(
  '/invoices/:invoiceId/transaction',
  bolepixController.getTransactionByInvoice
);

router.post(
  '/webhooks/mercadopago',
  bolepixController.mercadoPagoWebhook
);

router.post(
  '/mercadopago/reconcile',
  bolepixController.reconcileMercadoPago
);

module.exports = router;
