const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');

const {
  listUsers,
  getUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');

router.use(authMiddleware, isAdmin);

router.get('/', listUsers);
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
