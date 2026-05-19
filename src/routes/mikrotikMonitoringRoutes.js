const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const mikrotikMonitoringController = require('../controllers/mikrotikMonitoringController');

router.use(auth);
router.use(isAdmin);

router.get('/divergence', mikrotikMonitoringController.getDivergenceDashboard);
router.post('/client/:id/reconcile', mikrotikMonitoringController.reconcileClient);
router.get('/client/:id', mikrotikMonitoringController.getClientMonitoring);

module.exports = router;
