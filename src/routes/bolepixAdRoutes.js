const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const controller = require('../controllers/bolepixAdController');

router.use(auth, isAdmin);
router.get('/', controller.getAdmin);
router.put('/', controller.upsert);
router.patch('/active', controller.setActive);

module.exports = router;
