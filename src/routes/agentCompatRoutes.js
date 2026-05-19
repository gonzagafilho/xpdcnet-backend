const router = require('express').Router();
const agentNodeAuthMiddleware = require('../middlewares/agentNodeAuthMiddleware');
const agentCompatController = require('../controllers/agentCompatController');

router.use(agentNodeAuthMiddleware);

router.post('/poll', agentCompatController.poll);
router.post('/result', agentCompatController.result);

module.exports = router;
