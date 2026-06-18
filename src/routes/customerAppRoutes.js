const router = require('express').Router();
const customerAuth = require('../middlewares/customerAuthMiddleware');
const customerAppController = require('../controllers/customerAppController');
const customerAuthController = require('../controllers/customerAuthController');
const customerOtpController = require('../controllers/customerOtpController');
const customerNotificationController = require('../controllers/customerNotificationController');
const bolepixAdController = require('../controllers/bolepixAdController');

router.post('/auth/login', customerAuthController.login);
router.post('/auth/request-otp', customerOtpController.requestOtp);
router.post('/auth/verify-otp', customerOtpController.verifyOtp);
router.post('/auth/trusted-device-login', customerOtpController.trustedDeviceLogin);

router.use(customerAuth);

router.get('/auth/me', customerAuthController.me);
router.get('/me', customerAppController.getMe);
router.get('/dashboard', customerAppController.getExecutiveDashboard);
router.get('/plan', customerAppController.getPlan);
router.get('/connection', customerAppController.getConnection);
router.get('/network-map', customerAppController.getNetworkMap);
router.get('/pppoe', customerAppController.getPppoe);
router.get('/pppoe/live', customerAppController.getPppoeLive);
router.get('/pppoe/history', customerAppController.getPppoeHistory);
router.get('/invoices', customerAppController.listInvoices);
router.get('/invoices/:id/payment', customerAppController.getInvoicePayment);
router.get('/bolepix-ad', bolepixAdController.getActiveForCustomer);

router.get('/notifications', customerNotificationController.listNotifications);
router.get('/notifications/unread-count', customerNotificationController.unreadCount);
router.patch('/notifications/read-all', customerNotificationController.markAllAsRead);
router.patch('/notifications/:id/read', customerNotificationController.markAsRead);

router.post('/support/tickets', customerAppController.createSupportTicket);
router.get('/support/tickets', customerAppController.listSupportTickets);
router.get('/support/tickets/:id', customerAppController.getSupportTicket);

module.exports = router;
