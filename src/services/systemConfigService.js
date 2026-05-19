const SystemConfig = require('../models/SystemConfig');

const MIKROTIK_SECRET_CONFIG_KEY = 'MIKROTIK_SECRET_KEY';

exports.MIKROTIK_SECRET_CONFIG_KEY = MIKROTIK_SECRET_CONFIG_KEY;

/**
 * @returns {Promise<boolean>}
 */
exports.hasMikrotikSecretKeyRow = async function hasMikrotikSecretKeyRow() {
  const n = await SystemConfig.countDocuments({ key: MIKROTIK_SECRET_CONFIG_KEY }).limit(1);
  return n > 0;
};

/**
 * @returns {Promise<string|null>} segredo em texto — nunca logar
 */
exports.getMikrotikSecretKeyFromDb = async function getMikrotikSecretKeyFromDb() {
  const doc = await SystemConfig.findOne({ key: MIKROTIK_SECRET_CONFIG_KEY }).select('value').lean();
  if (!doc || doc.value == null || !String(doc.value).trim()) return null;
  return String(doc.value).trim();
};

/**
 * @param {string} value
 */
exports.setMikrotikSecretKeyInDb = async function setMikrotikSecretKeyInDb(value) {
  const v = value != null ? String(value).trim() : '';
  if (!v) throw new Error('Valor de chave vazio.');
  await SystemConfig.create({ key: MIKROTIK_SECRET_CONFIG_KEY, value: v });
};
