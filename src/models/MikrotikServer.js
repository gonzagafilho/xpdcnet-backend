const mongoose = require('mongoose');

/**
 * Equipamento MikroTik por tenant (credenciais API — evoluir para cofre/cripto em fase posterior).
 * Sem integração RouterOS nesta fase.
 */
const MikrotikServerSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** Opcional: equipamento físico neste node (filial); null = fluxo legado directo a partir da matriz. */
    networkNodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkNode', default: null, index: true },

    executionMode: {
      type: String,
      enum: ['auto', 'direct', 'agent'],
      default: 'auto',
    },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkNode', default: null, index: true },

    name: { type: String, required: true, trim: true },
    host: { type: String, required: true, trim: true },
    port: { type: Number, default: 8728 },
    username: { type: String, required: true, default: '' },
    password: { type: String, required: true, default: '' },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

MikrotikServerSchema.index({ tenantId: 1, name: 1 });

module.exports = mongoose.model('MikrotikServer', MikrotikServerSchema);
