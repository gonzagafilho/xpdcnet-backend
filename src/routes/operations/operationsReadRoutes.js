const router = require('express').Router();
const auth = require('../../middlewares/authMiddleware');
const isAdmin = require('../../middlewares/isAdmin');
const operationsReadController = require('../../controllers/operations/operationsReadController');

router.use(auth);
router.use(isAdmin);

router.get('/logs', operationsReadController.listOperationLogs);
router.get('/executive-dashboard', operationsReadController.executiveDashboard);
router.get('/client/:id/timeline', operationsReadController.clientTimeline);

module.exports = router;
