const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new ApiError(401, 'Token não fornecido');
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2) {
    throw new ApiError(401, 'Token mal formatado');
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    throw new ApiError(401, 'Token mal formatado');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // padrão único usado pelo sistema inteiro
    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    return next();
  } catch (error) {
    throw new ApiError(401, 'Token inválido ou expirado');
  }
};
