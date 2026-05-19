const networkNodeService = require('../services/networkNodeService');
const operationLogService = require('../services/operationLogService');

exports.list = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const items = await networkNodeService.listNodes(tenantId);
    res.json(Array.isArray(items) ? items : []);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const created = await networkNodeService.createNode(tenantId, req.body || {});
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const node = await networkNodeService.getNode(tenantId, req.params.id);
    res.json(node);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const updated = await networkNodeService.updateNode(tenantId, req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    await networkNodeService.deleteNode(tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

exports.rotateAgentToken = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const out = await networkNodeService.rotateAgentToken(tenantId, req.params.id);
    await operationLogService.logOperation({
      tenantId: req.tenant._id,
      userId: req.user && req.user.id ? req.user.id : null,
      action: 'network_node.agent_token_rotate',
      targetType: 'NetworkNode',
      targetId: String(req.params.id),
      status: 'success',
      req,
    });
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
};
