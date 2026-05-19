const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const systemSetupController = require('../controllers/systemSetupController');

router.post('/crypto', auth, isAdmin, systemSetupController.initializeCrypto);

module.exports = router;
