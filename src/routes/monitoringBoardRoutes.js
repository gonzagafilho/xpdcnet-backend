const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const monitoringBoardController = require('../controllers/monitoringBoardController');

router.use(auth);
router.use(isAdmin);

router.get('/client/:id', monitoringBoardController.getClientMonitoring);
router.get('/session-board', monitoringBoardController.getSessionBoard);

module.exports = router;
