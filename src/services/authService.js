const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ApiError = require('../errors/ApiError');
const User = require('../models/User');
const Role = require('../models/Role');

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

exports.registerOwner = async ({ tenantId, name, email, password }) => {
  if (!tenantId || !name || !email || !password) throw ApiError.badRequest('Campos obrigatórios faltando');

  let ownerRole = await Role.findOne({ tenantId, name: 'owner' });
  if (!ownerRole) {
    ownerRole = await Role.create({
      tenantId,
      name: 'owner',
      permissions: ['*'],
    });
  }

  const exists = await User.findOne({ tenantId, email: email.toLowerCase() });
  if (exists) throw ApiError.conflict('Email já cadastrado');

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    tenantId,
    name,
    email: email.toLowerCase(),
    passwordHash,
    roleId: ownerRole._id,
  });

  return user;
};

exports.login = async ({ tenantId, email, password }) => {
  if (!tenantId || !email || !password) throw ApiError.badRequest('tenantId, email e password são obrigatórios');

  const user = await User.findOne({ tenantId, email: email.toLowerCase(), isActive: true });
  if (!user) throw ApiError.unauthorized('Credenciais inválidas');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw ApiError.unauthorized('Credenciais inválidas');

  const accessToken = signAccessToken({
    sub: user._id.toString(),
    tenantId: user.tenantId.toString(),
    roleId: user.roleId.toString(),
  });

  return { accessToken };
};
