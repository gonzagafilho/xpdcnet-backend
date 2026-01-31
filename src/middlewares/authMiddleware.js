const jwt = require('jsonwebtoken');
const ApiError = require('../errors/ApiError');

module.exports = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(ApiError.unauthorized('Token ausente'));

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // {sub, tenantId, roleId}
    next();
  } catch (err) {
    return next(ApiError.unauthorized('Token inválido'));
  }
};
