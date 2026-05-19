const Client = require('../models/Client');
const networkNodeService = require('../services/networkNodeService');
const remoteAgentCommandService = require('../services/remoteAgentCommandService');
const operationLogService = require('../services/operationLogService');

exports.heartbeat = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const meta = req.body && typeof req.body === 'object' ? req.body : null;
    await networkNodeService.touchAgentHeartbeat(node._id, meta);
    res.json({ ok: true, nodeId: String(node._id) });
  } catch (err) {
    next(err);
  }
};

exports.nextCommand = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const cmd = await remoteAgentCommandService.claimNextPendingForNode(node._id);
    if (!cmd) {
      res.status(204).send();
      return;
    }
    res.json(cmd);
  } catch (err) {
    next(err);
  }
};

exports.completeCommand = async (req, res, next) => {
  try {
    const node = req.networkNode;
    const commandId = req.params.id;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const r = await remoteAgentCommandService.completeCommandForNode(node._id, commandId, body);
    if (r.error === 'invalid_id') {
      res.status(400).json({ error: r.error });
      return;
    }
    if (r.error) {
      res.status(404).json({ error: r.error });
      return;
    }

    const cmd = r.command;
    if (cmd && cmd.clientId && cmd.kind !== 'MONITORING_INSPECT') {
      const now = new Date();
      const success = body.success !== false;
      const errMsg = body.error != null ? String(body.error).slice(0, 2000) : '';
      await Client.updateOne(
        { _id: cmd.clientId, tenantId: cmd.tenantId },
        {
          $set: {
            'mikrotik.sync.state': success ? 'in_sync' : 'error',
            'mikrotik.sync.lastAttemptAt': now,
            ...(success
              ? { 'mikrotik.sync.lastSuccessAt': now, 'mikrotik.sync.lastErrorMessage': '' }
              : { 'mikrotik.sync.lastErrorMessage': errMsg || 'Agente remoto reportou falha.' }),
          },
        },
      );
    }

    if (cmd) {
      const success = body.success !== false;
      await operationLogService.logOperation({
        tenantId: cmd.tenantId,
        userId: null,
        action: 'remote_agent.command.complete',
        targetType: 'RemoteAgentCommand',
        targetId: String(cmd._id),
        payload: { kind: cmd.kind, networkNodeId: String(node._id) },
        result: { success, action: body.action, message: body.message },
        status: success ? 'success' : 'error',
        errorMessage: success ? '' : String(body.error || ''),
        req,
      });
    }

    res.json({ ok: true, command: cmd });
  } catch (err) {
    next(err);
  }
};
