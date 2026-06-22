const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const clientController = require('../controllers/clientController');

router.use(auth);
router.use(isAdmin);

router.post('/', clientController.create);
router.get('/', clientController.list);
router.get('/summary', clientController.summary);
router.get('/export.csv', clientController.exportCsv);
router.get('/:id/accesses', clientController.listAccesses);
router.get('/:id/operational-details', clientController.operationalDetails);
router.get('/:id/network-intent', clientController.getNetworkIntent);
router.get('/:id', clientController.getById);
router.put('/:id', clientController.update);
router.delete('/:id', clientController.remove);

module.exports = router;

