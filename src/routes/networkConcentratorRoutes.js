const router = require('express').Router();

const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const networkConcentratorController = require('../controllers/networkConcentratorController');

router.use(auth);
router.use(isAdmin);

router.get('/', networkConcentratorController.list);
router.post('/', networkConcentratorController.create);
router.patch('/:id', networkConcentratorController.update);
router.delete('/:id', networkConcentratorController.remove);
router.post('/:id/test', networkConcentratorController.testConnection);

module.exports = router;
