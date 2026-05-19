const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const systemHealthController = require('../controllers/systemHealthController');

router.use(auth);
router.use(isAdmin);

router.get('/', systemHealthController.getDeepHealth);

module.exports = router;
