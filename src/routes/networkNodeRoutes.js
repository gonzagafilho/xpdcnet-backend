const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const networkNodeController = require('../controllers/networkNodeController');

router.use(auth);
router.use(isAdmin);

router.get('/', networkNodeController.list);
router.post('/', networkNodeController.create);
router.post('/:id/agent-token/rotate', networkNodeController.rotateAgentToken);
router.get('/:id', networkNodeController.getById);
router.put('/:id', networkNodeController.update);
router.delete('/:id', networkNodeController.remove);

module.exports = router;
