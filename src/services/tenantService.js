const Tenant = require('../models/Tenant');
const ApiError = require('../errors/ApiError');

exports.createTenant = async ({ name, slug }) => {
  if (!name || !slug) throw ApiError.badRequest('name e slug são obrigatórios');

  const exists = await Tenant.findOne({ slug });
  if (exists) throw ApiError.conflict('slug já existe');

  return Tenant.create({ name, slug });
};

exports.listTenants = async () => {
  return Tenant.find().sort({ createdAt: -1 });
};
