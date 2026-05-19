const mongoose = require('mongoose');

/**
 * Ponto de execução MikroTik no desenho multi-node (matriz / filial via agente).
 * Cliente e/ou MikrotikServer podem referenciar um node; ausência = fluxo legado (ligação directa a partir da matriz).
 */
const NetworkNodeSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    name: { type: String, required: true, trim: true },
    /** Código curto estável para operações e env do agente (único por tenant). */
    code: { type: String, required: true, trim: true, uppercase: true },

    type: {
      type: String,
      enum: ['LOCAL', 'REMOTE_AGENT'],
      required: true,
      index: true,
    },

    /** Estado operacional derivado (ex.: heartbeat do agente). */
    status: {
      type: String,
      enum: ['unknown', 'online', 'offline'],
      default: 'unknown',
    },

    /**
     * DIRECT_API: worker/API na matriz abre socket para o host do MikrotikServer (legado).
     * REMOTE_AGENT_OUTBOUND: execução na filial via agente (saída HTTPS sem inbound na filial).
     */
    connectionMode: {
      type: String,
      enum: ['DIRECT_API', 'REMOTE_AGENT_OUTBOUND'],
      required: true,
    },

    /** Opcional: anotação de gestão (IP interno da matriz, FQDN do túnel, etc.). */
    host: { type: String, default: '', trim: true },
    config: { type: mongoose.Schema.Types.Mixed, default: null },

    timeoutMs: { type: Number, default: 20_000 },
    isActive: { type: Boolean, default: true, index: true },

    /** Só para type REMOTE_AGENT — SHA-256 hex do token (plain mostrado uma vez na criação). */
    agentTokenHash: { type: String, default: null, select: false },
    agentLastSeenAt: { type: Date, default: null },
    /** Metadado livre enviado no heartbeat (versão do binário, hostname, etc.). */
    agentMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

NetworkNodeSchema.index({ tenantId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('NetworkNode', NetworkNodeSchema);
