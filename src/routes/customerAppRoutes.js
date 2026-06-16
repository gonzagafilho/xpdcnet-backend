const router = require('express').Router();
const customerAuth = require('../middlewares/customerAuthMiddleware');
const customerAppController = require('../controllers/customerAppController');
const customerAuthController = require('../controllers/customerAuthController');

router.post('/auth/login', customerAuthController.login);

router.use(customerAuth);

router.get('/auth/me', customerAuthController.me);
router.get('/me', customerAppController.getMe);
router.get('/plan', customerAppController.getPlan);
router.get('/connection', customerAppController.getConnection);
router.get('/invoices', customerAppController.listInvoices);
router.get('/invoices/:id/payment', customerAppController.getInvoicePayment);

router.post('/support/tickets', customerAppController.createSupportTicket);
router.get('/support/tickets', customerAppController.listSupportTickets);
router.get('/support/tickets/:id', customerAppController.getSupportTicket);

module.exports = router;
