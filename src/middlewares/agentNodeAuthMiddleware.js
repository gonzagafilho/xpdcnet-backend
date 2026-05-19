const networkNodeService = require('../services/networkNodeService');

/** Autenticação do agente remoto: cabeçalhos + Bearer separados do JWT do painel. */
module.exports = async function agentNodeAuthMiddleware(req, res, next) {
  try {
    const nodeHeader = req.headers['x-xpdcnet-node-id'];
    const nodeId = nodeHeader != null ? String(nodeHeader).trim() : '';
    const auth = req.headers.authorization;
    const m = auth && String(auth).match(/^Bearer\s+(.+)$/i);
    const token = m ? String(m[1]).trim() : '';

    const v = await networkNodeService.verifyAgentCredentials(nodeId, token);
    if (!v.ok) {
      res.status(401).json({ error: 'agent_auth_failed', detail: v.reason });
      return;
    }
    req.networkNode = v.node;
    next();
  } catch (err) {
    next(err);
  }
};
