const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const mikrotikServerController = require('../controllers/mikrotikServerController');

router.use(auth);
router.use(isAdmin);

router.post('/', mikrotikServerController.create);
router.get('/', mikrotikServerController.list);
router.get('/monitoring', mikrotikServerController.monitoringSnapshot);
router.get('/:id/monitoring', mikrotikServerController.serverMonitoringDetail);
router.get('/:id', mikrotikServerController.getById);
router.put('/:id', mikrotikServerController.update);
router.delete('/:id', mikrotikServerController.remove);

module.exports = router;
