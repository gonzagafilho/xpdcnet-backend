const router = require('express').Router();
const tenantController = require('../controllers/tenantController');
const authMiddleware = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');

// Rotas sensíveis de tenant: exigem autenticação administrativa.
router.use(authMiddleware, isAdmin);

router.post('/', tenantController.create);
router.get('/', tenantController.list);
router.get('/finance-policy', tenantController.getFinancePolicy);
router.put('/finance-policy', tenantController.updateFinancePolicy);

module.exports = router;
