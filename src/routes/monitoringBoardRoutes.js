const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const requireMikrotikCryptoConfigured = require('../middlewares/requireMikrotikCryptoConfigured');
const monitoringBoardController = require('../controllers/monitoringBoardController');

router.use(auth);
router.use(isAdmin);

router.get('/client/:id', requireMikrotikCryptoConfigured, monitoringBoardController.getClientMonitoring);
router.get('/session-board', requireMikrotikCryptoConfigured, monitoringBoardController.getSessionBoard);
router.get('/queue-health', monitoringBoardController.getQueueHealth);

module.exports = router;
