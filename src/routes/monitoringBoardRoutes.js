const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const requireMikrotikCryptoConfigured = require('../middlewares/requireMikrotikCryptoConfigured');
const monitoringBoardController = require('../controllers/monitoringBoardController');

router.use(auth);
router.use(isAdmin);

router.get('/concentrators', monitoringBoardController.getConcentratorsCentral);
router.get('/concentrators/:id', monitoringBoardController.getConcentratorCentralDetail);
router.get('/alerts', monitoringBoardController.getConcentratorAlerts);
router.get('/alerts/open', monitoringBoardController.getOpenConcentratorAlerts);
router.post('/alerts/:id/resolve', monitoringBoardController.resolveConcentratorAlert);
router.get('/client/:id', requireMikrotikCryptoConfigured, monitoringBoardController.getClientMonitoring);
router.get('/session-board', requireMikrotikCryptoConfigured, monitoringBoardController.getSessionBoard);
router.get('/queue-health', monitoringBoardController.getQueueHealth);
router.get('/noc-history', monitoringBoardController.getNocHistory);
router.get('/noc-incidents', monitoringBoardController.getNocIncidents);
router.get('/noc-sla', monitoringBoardController.getNocSla);
router.get('/stream', monitoringBoardController.streamQueueHealth);

module.exports = router;
