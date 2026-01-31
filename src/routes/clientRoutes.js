const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const tenant = require('../middlewares/tenantMiddleware');
const clientController = require('../controllers/clientController');

router.use(tenant);
router.use(auth);

router.post('/', clientController.create);
router.get('/', clientController.list);
router.get('/:id', clientController.getById);
router.put('/:id', clientController.update);
router.delete('/:id', clientController.remove);

module.exports = router;
