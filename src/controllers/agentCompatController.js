const remoteAgentController = require('./remoteAgentController');

exports.poll = async (req, res, next) => remoteAgentController.nextCommand(req, res, next);

exports.result = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const commandId = body.commandId != null ? String(body.commandId) : body.id != null ? String(body.id) : '';
    if (!commandId) {
      res.status(400).json({ error: 'command_id_required', message: 'Envie commandId (ou id) no corpo JSON.' });
      return;
    }
    req.params = { ...req.params, id: commandId };
    return remoteAgentController.completeCommand(req, res, next);
  } catch (err) {
    next(err);
  }
};
