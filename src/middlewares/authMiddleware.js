const jwt = require('jsonwebtoken');
const ApiError = require('../errors/ApiError');
const { getJwtSecret } = require('../config/jwt');

module.exports = (req, res, next) => {
  try {
    const secret = getJwtSecret();
    if (!secret) {
      console.error('[AUTH] JWT não configurado (produção)');
      return next(ApiError.serviceUnavailable('Configuração do servidor incompleta.', 'SERVER_MISCONFIGURED'));
    }

    const header = req.headers.authorization || '';

let token = null;

if (header.startsWith('Bearer ')) {
  token = header.slice(7);
}

/**
 * SSE/EventSource não suporta Authorization header.
 * Permitir ?token= SOMENTE na rota realtime /stream.
 */
if (
  !token &&
  req.path === '/stream' &&
  req.query &&
  typeof req.query.token === 'string'
) {
  token = String(req.query.token).trim();
}

if (!token) {
      console.warn('[AUTH] acesso negado: token ausente method=%s path=%s ip=%s', req.method, req.originalUrl, req.ip);
      return next(ApiError.unauthorized('Token ausente'));
    }

    const payload = jwt.verify(token, secret);
    req.user = payload;

    /* Painel Admin: JWT com { id, email, role } */
    if (payload.role) {
      req.userRole = payload.role;
    }
    /* Fluxo User legado: { sub, tenantId, roleId } */
    if (payload.sub && !payload.id) {
      req.user.id = payload.sub;
    }

    next();
  } catch (err) {
    console.warn('[AUTH] acesso negado: token inválido method=%s path=%s ip=%s', req.method, req.originalUrl, req.ip);
    return next(ApiError.unauthorized('Token inválido'));
  }
};
