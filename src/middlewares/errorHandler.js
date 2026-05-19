const ApiError = require('../errors/ApiError');

function isDatabaseError(err) {
  const name = err.name || '';
  const msg = String(err.message || '');
  return (
    name === 'MongoServerError' ||
    name === 'MongoNetworkError' ||
    name === 'MongooseError' ||
    /MongoNetworkError|MongooseServerSelectionError|not connected|ECONNREFUSED|Authentication failed/i.test(
      msg,
    )
  );
}

module.exports = (err, req, res, next) => {
  if (err instanceof ApiError) {
    const body = { message: err.message };
    if (err.code) body.code = err.code;
    if (err.code === 'SYSTEM_NOT_CONFIGURED') body.error = 'SYSTEM_NOT_CONFIGURED';
    if (err.details != null) body.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  if (isDatabaseError(err)) {
    console.error('[DB]', err.message);
    return res.status(503).json({
      message: 'Sistema temporariamente indisponível (banco de dados).',
      code: 'DATABASE_UNAVAILABLE',
    });
  }

  console.error('[ERROR]', err.message || err);

  return res.status(500).json({
    message: 'Erro interno do servidor',
    code: 'INTERNAL_ERROR',
  });
};
