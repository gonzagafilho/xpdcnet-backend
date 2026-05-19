const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const mikrotikSyncController = require('../controllers/mikrotikSyncController');

router.use(auth);
router.use(isAdmin);

router.get('/jobs', mikrotikSyncController.listJobs);
router.get('/summary', mikrotikSyncController.summary);
router.post('/enqueue', mikrotikSyncController.enqueue);
router.post('/:id/retry', mikrotikSyncController.retry);

module.exports = router;
