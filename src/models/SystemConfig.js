const mongoose = require('mongoose');

/**
 * Pares chave/valor de configuração global (ex.: material de criptografia MikroTik).
 * O valor de segredos nunca deve ser registado em logs.
 */
const SystemConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    value: { type: String, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SystemConfig', SystemConfigSchema);
