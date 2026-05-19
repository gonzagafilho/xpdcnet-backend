const encryptionService = require('../services/encryptionService');

/**
 * Bloqueia rotas que dependem de criptografia MikroTik quando não há chave (BD nem .env).
 */
module.exports = async function requireMikrotikCryptoConfigured(req, res, next) {
  try {
    await encryptionService.hydrateMikrotikSecretFromDatabase();
    if (!encryptionService.isMikrotikSecretConfigured()) {
      return res.status(503).json({
        error: 'SYSTEM_NOT_CONFIGURED',
        message: 'Sistema precisa ser configurado',
      });
    }
    return next();
  } catch (err) {
    return res.status(503).json({
      error: 'SYSTEM_NOT_CONFIGURED',
      message: 'Sistema precisa ser configurado',
    });
  }
};
