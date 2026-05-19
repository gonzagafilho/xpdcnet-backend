const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const invoiceController = require('../controllers/invoiceController');

router.use(auth);
router.use(isAdmin);

router.post('/generate-month', invoiceController.generateMonth);
router.post('/', invoiceController.create);
router.get('/', invoiceController.list);
router.get('/summary', invoiceController.summary);
router.get('/finance-policy-impact', invoiceController.financePolicyImpact);
router.get('/:id', invoiceController.getById);
router.put('/:id', invoiceController.update);
router.delete('/:id', invoiceController.remove);

module.exports = router;
