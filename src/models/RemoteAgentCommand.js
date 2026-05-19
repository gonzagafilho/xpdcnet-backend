const mongoose = require('mongoose');

/**
 * Fila mínima de comandos para o agente remoto (outbound).
 * Conteúdo pode incluir credenciais em trânsito curto — restringir acesso à base e usar HTTPS no agents.
 */
const RemoteAgentCommandSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    networkNodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkNode', required: true, index: true },

    /** Ligação opcional ao job de sync central (idempotência). */
    mikrotikSyncJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikSyncJob', default: null, index: true },
    /** Opcional para comandos só de equipamento (snapshot NOC via agente). */
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikServer', default: null },

    kind: {
      type: String,
      enum: ['SYNC_INTENT', 'MONITORING_INSPECT', 'SERVER_SNAPSHOT', 'SERVER_SNAPSHOT_DETAIL'],
      default: 'SYNC_INTENT',
    },

    status: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
      index: true,
    },

    payload: { type: mongoose.Schema.Types.Mixed, default: null },

    resultSuccess: { type: Boolean, default: null },
    resultAction: { type: String, default: null },
    resultMessage: { type: String, default: '' },
    resultError: { type: String, default: '' },

    lockedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

RemoteAgentCommandSchema.index({ networkNodeId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('RemoteAgentCommand', RemoteAgentCommandSchema);
