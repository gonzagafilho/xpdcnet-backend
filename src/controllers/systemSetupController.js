const crypto = require('crypto');
const ApiError = require('../errors/ApiError');
const systemConfigService = require('../services/systemConfigService');
const encryptionService = require('../services/encryptionService');

/**
 * POST /system/setup/crypto
 * Gera e persiste MIKROTIK_SECRET_KEY na base (uma única vez).
 * Nunca devolve o segredo completo.
 */
exports.initializeCrypto = async (req, res, next) => {
  try {
    const envKey = process.env.MIKROTIK_SECRET_KEY != null ? String(process.env.MIKROTIK_SECRET_KEY).trim() : '';
    if (envKey) {
      throw ApiError.conflict(
        'MIKROTIK_SECRET_KEY está definida no ambiente. Remova-a do .env para poder gerar a chave pelo painel (evita duas fontes de verdade).',
        'MIKROTIK_ENV_KEY_PRESENT',
      );
    }

    if (await systemConfigService.hasMikrotikSecretKeyRow()) {
      throw ApiError.conflict('Chave de criptografia MikroTik já está configurada na base.', 'MIKROTIK_KEY_ALREADY_SET');
    }

    const secret = crypto.randomBytes(32).toString('base64');
    await systemConfigService.setMikrotikSecretKeyInDb(secret);
    await encryptionService.reloadMikrotikSecretFromDatabase();

    const hint = secret.slice(0, 4);
    return res.status(201).json({
      ok: true,
      keyHint: `${hint}…`,
      message: 'Chave gerada e guardada. Guarde o acesso ao painel; o segredo completo não será mostrado novamente.',
    });
  } catch (err) {
    next(err);
  }
};
