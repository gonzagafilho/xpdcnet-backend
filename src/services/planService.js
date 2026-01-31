const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Plan = require('../models/Plan');

exports.create = async (tenantId, data) => {
  const { name, speedMbps, price, billingCycle, authType, mikrotik } = data;

  if (!name || !speedMbps || price === undefined) {
    throw ApiError.badRequest('name, speedMbps e price são obrigatórios');
  }

  const plan = await Plan.create({
    tenantId,
    name,
    speedMbps: Number(speedMbps),
    price: Number(price),
    billingCycle: billingCycle || 'monthly',
    authType: authType || 'pppoe',
    mikrotik: mikrotik || {},
  });

  return plan;
};

exports.list = async (tenantId) => {
  return Plan.find({ tenantId }).sort({ createdAt: -1 });
};

exports.getById = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const plan = await Plan.findOne({ _id: id, tenantId });
  if (!plan) throw ApiError.notFound('Plano não encontrado');

  return plan;
};

exports.update = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const updated = await Plan.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: data },
    { new: true }
  );

  if (!updated) throw ApiError.notFound('Plano não encontrado');

  return updated;
};

exports.remove = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const deleted = await Plan.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('Plano não encontrado');

  return true;
};
