const express = require('express');
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');

const router = express.Router();

router.post('/login', authController.login);
router.post('/reset-password', authController.resetPassword);
router.post('/admin/users/:id/reset-password-link', authMiddleware, isAdmin, authController.adminGenerateReset);

module.exports = router;
