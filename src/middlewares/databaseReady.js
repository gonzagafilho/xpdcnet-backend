const mongoose = require('mongoose');

/**
 * Responde 503 padronizado quando a API não pode usar a base de dados.
 * /health fica registado antes deste middleware.
 */
module.exports = function databaseReady(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();

  return res.status(503).json({
    message: 'Sistema temporariamente indisponível (banco de dados).',
    code: 'DATABASE_UNAVAILABLE',
  });
}
