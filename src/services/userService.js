const mongoose = require('mongoose');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

function ensureValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'ID de usuário inválido');
  }
}

exports.listUsers = async () => {
  const users = await User.find().select('-password');
  return users;
};

exports.getUserById = async (id) => {
  ensureValidObjectId(id);

  const user = await User.findById(id).select('-password');
  if (!user) {
    throw new ApiError(404, 'Usuário não encontrado');
  }
  return user;
};

exports.updateUser = async (id, data) => {
  ensureValidObjectId(id);

  const allowedFields = ['name', 'role', 'isActive'];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  });

  // opcional (mas bom): evitar update vazio
  if (Object.keys(updateData).length === 0) {
    throw new ApiError(400, 'Nenhum campo válido para atualizar');
  }

  const user = await User.findByIdAndUpdate(id, updateData, { new: true })
    .select('-password');

  if (!user) {
    throw new ApiError(404, 'Usuário não encontrado');
  }

  return user;
};

exports.deleteUser = async (id) => {
  ensureValidObjectId(id);

  const user = await User.findByIdAndDelete(id);
  if (!user) {
    throw new ApiError(404, 'Usuário não encontrado');
  }

  return true;
};
