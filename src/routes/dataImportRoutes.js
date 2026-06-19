const router = require('express').Router();
const auth = require('../middlewares/authMiddleware');
const isAdmin = require('../middlewares/isAdmin');
const controller = require('../controllers/dataImportController');

router.use(auth);
router.use(isAdmin);

router.get('/targets', controller.listTargets);
router.post('/customers/preview', controller.previewCustomers);
router.post('/customers/:id/confirm', controller.confirmCustomers);
router.get('/template.csv', controller.downloadTemplate);
router.get('/jobs', controller.listJobs);

module.exports = router;
