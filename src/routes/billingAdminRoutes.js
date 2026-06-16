const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const billingAdminController = require('../controllers/billingAdminController');

router.use(auth);
router.use(isAdmin);

router.get('/adapters', billingAdminController.listAdapters);

router.get('/providers', billingAdminController.listProviders);
router.post('/providers', billingAdminController.createProvider);
router.get('/providers/:id', billingAdminController.getProvider);
router.put('/providers/:id', billingAdminController.updateProvider);
router.patch('/providers/:id/active', billingAdminController.setProviderActive);

router.get('/accounts', billingAdminController.listAccounts);
router.post('/accounts', billingAdminController.createAccount);
router.get('/accounts/:id', billingAdminController.getAccount);
router.put('/accounts/:id', billingAdminController.updateAccount);
router.patch('/accounts/:id/active', billingAdminController.setAccountActive);
router.post('/accounts/:id/default', billingAdminController.setDefaultAccount);

router.get('/invoices', billingAdminController.listBillingInvoices);
router.get('/invoices/:id', billingAdminController.getBillingInvoice);
router.post('/invoices/:id/sync-status', billingAdminController.syncBillingInvoiceStatus);
router.post('/invoices/:id/cancel', billingAdminController.cancelBillingInvoice);

router.get('/events/webhooks', billingAdminController.listWebhookEvents);
router.get('/events/audit', billingAdminController.listAuditLogs);

module.exports = router;
