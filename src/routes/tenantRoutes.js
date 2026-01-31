const router = require('express').Router();
const tenantController = require('../controllers/tenantController');

// inicial (admin do SaaS)
// depois você trava com auth + RBAC
router.post('/', tenantController.create);
router.get('/', tenantController.list);

module.exports = router;
