const ApiError = require('../utils/ApiError');

module.exports = (err, req, res, next) => {
  // ✅ agora o err existe aqui dentro
  console.error('[ERROR_HANDLER]', err);

  if (res.headersSent) return next(err);

  // Erro tratado (nosso padrão)
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Erro de validação do Mongoose
  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Erro de validação',
      details: err.errors,
    });
  }

  // Erro inesperado
  return res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
  });
};
