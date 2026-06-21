const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const planController = require('../controllers/planController');

router.use(auth);
router.use(isAdmin);

router.post('/', planController.create);
router.get('/', planController.list);
router.get('/options', planController.listOptions);
router.get('/:id', planController.getById);
router.put('/:id', planController.update);
router.patch('/:id/status', planController.updateStatus);
router.delete('/:id', planController.remove);

module.exports = router;

