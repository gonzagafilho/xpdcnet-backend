const router = require('express').Router();
const authController = require('../controllers/authController');

router.post('/register-owner', authController.registerOwner);
router.post('/login', authController.login);

module.exports = router;
