const ApiError = require('../errors/ApiError');

module.exports = (err, req, res, next) => {
  // erro esperado
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      message: err.message,
      details: err.details ?? null,
    });
  }

  // erro do mongoose ou qualquer outro
  console.error('[ERROR]', err);

  return res.status(500).json({
    message: 'Erro interno do servidor',
  });
};

