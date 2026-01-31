const Tenant = require('../models/Tenant');
const ApiError = require('../errors/ApiError');

module.exports = async (req, res, next) => {
  try {
    const slug = req.headers['x-tenant'];
    if (!slug) return next(ApiError.badRequest('Header x-tenant é obrigatório. Ex: x-tenant: dcnet'));

    const tenant = await Tenant.findOne({ slug, isActive: true });
    if (!tenant) return next(ApiError.notFound('Tenant não encontrado ou inativo'));

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
};
