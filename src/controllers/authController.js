const authService = require('../services/authService');

exports.registerOwner = async (req, res, next) => {
  try {
    // precisa do tenant resolvido
    const tenantId = req.tenant._id.toString();
    const user = await authService.registerOwner({ tenantId, ...req.body });
    res.status(201).json({ id: user._id, email: user.email, name: user.name });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const result = await authService.login({ tenantId, ...req.body });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
