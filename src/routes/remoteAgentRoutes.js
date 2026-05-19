const router = require('express').Router();
const agentNodeAuthMiddleware = require('../middlewares/agentNodeAuthMiddleware');
const remoteAgentController = require('../controllers/remoteAgentController');

router.use(agentNodeAuthMiddleware);

router.post('/heartbeat', remoteAgentController.heartbeat);
router.get('/commands/next', remoteAgentController.nextCommand);
router.post('/commands/:id/complete', remoteAgentController.completeCommand);

module.exports = router;
