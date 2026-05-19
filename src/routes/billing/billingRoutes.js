const router = require('express').Router();
const auth = require('../../middlewares/authMiddleware');
const isAdmin = require('../../middlewares/isAdmin');
const billingController = require('../../controllers/billing/billingController');
const billingOperationsController = require('../../controllers/billing/billingOperationsController');

/** Webhook Cora (e outros) — público; autenticação via validação no adapter + id de conta. */
router.post('/webhook/:billingAccountId', billingController.receiveWebhook);

router.use(auth);
router.use(isAdmin);

router.get('/adapters', billingController.listAdapters);
router.get('/providers', billingController.listProviders);
router.post('/providers', billingController.createProvider);
router.get('/accounts', billingController.listAccounts);
router.post('/accounts', billingController.createAccount);
router.get('/policy', billingController.getPolicy);
router.put('/policy', billingController.updatePolicy);
router.post('/issue/invoice/:invoiceId', billingController.issueFromInvoice);
router.post('/invoices/:id/sync-from-provider', billingController.syncBillingInvoice);

router.get('/operations/summary', billingOperationsController.getSummary);
router.get('/operations/invoices', billingOperationsController.listInvoices);
router.get('/operations/invoices/:id/timeline', billingOperationsController.getInvoiceTimeline);

module.exports = router;
