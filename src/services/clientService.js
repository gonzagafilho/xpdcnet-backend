const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const Plan = require('../models/Plan');

exports.create = async (tenantId, data) => {
  const {
    fullName,
    document,
    phone,
    email,
    address,
    geo,
    planId,
    monthlyPrice,
    dueDay,
    access,
    status,
    notes,
  } = data;

  if (!fullName || !planId || monthlyPrice === undefined || !access?.username || !access?.password) {
    throw ApiError.badRequest('fullName, planId, monthlyPrice, access.username e access.password são obrigatórios');
  }

  if (!mongoose.Types.ObjectId.isValid(planId)) throw ApiError.badRequest('planId inválido');

  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw ApiError.notFound('Plano não encontrado para este tenant');

  const dd = dueDay ? Number(dueDay) : 10;
  if (dd < 1 || dd > 28) throw ApiError.badRequest('dueDay deve estar entre 1 e 28');

  const client = await Client.create({
    tenantId,
    fullName,
    document: document || '',
    phone: phone || '',
    email: email || '',
    address: address || {},
    geo: geo || {},
    planId,
    monthlyPrice: Number(monthlyPrice),
    dueDay: dd,
    access: {
      authType: access?.authType || plan.authType || 'pppoe',
      username: access.username,
      password: access.password,
    },
    status: status || 'active',
    notes: notes || '',
  });

  return client;
};

exports.list = async (tenantId, query = {}) => {
  const filter = { tenantId };

  if (query.status) filter.status = query.status;
  if (query.search) {
    filter.$or = [
      { fullName: { $regex: query.search, $options: 'i' } },
      { document: { $regex: query.search, $options: 'i' } },
      { 'access.username': { $regex: query.search, $options: 'i' } },
    ];
  }

  return Client.find(filter)
    .sort({ createdAt: -1 })
    .populate('planId', 'name speedMbps price authType');
};

exports.getById = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const client = await Client.findOne({ _id: id, tenantId }).populate('planId', 'name speedMbps price authType');
  if (!client) throw ApiError.notFound('Cliente não encontrado');

  return client;
};

exports.update = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  // se for trocar plano, valida o planId
  if (data.planId) {
    if (!mongoose.Types.ObjectId.isValid(data.planId)) throw ApiError.badRequest('planId inválido');

    const plan = await Plan.findOne({ _id: data.planId, tenantId });
    if (!plan) throw ApiError.notFound('Plano não encontrado para este tenant');
  }

  // se vier dueDay, valida
  if (data.dueDay !== undefined) {
    const dd = Number(data.dueDay);
    if (dd < 1 || dd > 28) throw ApiError.badRequest('dueDay deve estar entre 1 e 28');
    data.dueDay = dd;
  }

  const updated = await Client.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: data },
    { new: true }
  ).populate('planId', 'name speedMbps price authType');

  if (!updated) throw ApiError.notFound('Cliente não encontrado');

  return updated;
};

exports.remove = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const deleted = await Client.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('Cliente não encontrado');

  return true;
};
