const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

exports.register = async ({ name, email, password }) => {
  if (!name || !email || !password) {
    throw new ApiError(400, 'Preencha todos os campos');
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    throw new ApiError(400, 'Usuário já cadastrado');
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role: 'user',
    status: 'active',
  });

  const token = signToken(user);

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    token,
  };
};

exports.login = async ({ email, password }) => {
  if (!email || !password) {
    throw new ApiError(400, 'Preencha todos os campos');
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new ApiError(401, 'Credenciais inválidas');
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new ApiError(401, 'Credenciais inválidas');
  }

  const token = signToken(user);

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    token,
  };
};

exports.me = async ({ userId }) => {
  const user = await User.findById(userId).select('-password');
  if (!user) {
    throw new ApiError(404, 'Usuário não encontrado');
  }

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };
};
