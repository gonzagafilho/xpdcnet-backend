const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '1d',
    }
  );
};

const registerUser = async ({ name, email, password }) => {
  const userExists = await User.findOne({ email });
  if (userExists) {
    throw new ApiError(400, 'Usuário já existe');
  }

  const user = await User.create({
    name,
    email,
    password,
  });

  return {
    user,
    token: generateToken(user),
  };
};

const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Credenciais inválidas');
  }

  return {
    user,
    token: generateToken(user),
  };
};

const getMe = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'Usuário não encontrado');
  }
  return user;
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
};
