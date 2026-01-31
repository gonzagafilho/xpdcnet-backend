const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const tenant = require('../middlewares/tenantMiddleware');
const planController = require('../controllers/planController');

router.use(tenant);
router.use(auth);

router.post('/', planController.create);
router.get('/', planController.list);
router.get('/:id', planController.getById);
router.put('/:id', planController.update);
router.delete('/:id', planController.remove);

module.exports = router;
