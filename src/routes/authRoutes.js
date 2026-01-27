const express = require('express');
const router = express.Router();

const { register, login, me } = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');

router.post('/register', register);
router.post('/login', login);

// /me REAL (busca no banco)
router.get('/me', authMiddleware, me);

// rota SOMENTE ADMIN
router.get('/admin', authMiddleware, isAdmin, (req, res) => {
  return res.status(200).json({
    message: 'Bem-vindo, administrador',
    adminId: req.userId
  });
});

module.exports = router;

