const mongoose = require('mongoose');

/**
 * Fila de sincronização MikroTik (persistência + auditoria).
 * A criação do documento não abre RouterOS; o processamento depende do worker
 * (MIKROTIK_SYNC_EXECUTION_MODE: simulate | dry-run | live — ver mikrotikSyncWorker.js).
 */
const MikrotikSyncJobSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikServer', default: null, index: true },
    /** Snapshot de resolveNetworkIntent no momento do enqueue. */
    intentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Rastreabilidade da origem do enqueue (compatível com jobs antigos). */
    triggerReason: { type: String, default: null },
    triggerSource: { type: String, default: null },
    triggerContext: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    /** Última execução terminal (worker) — leitura operacional; não substitui intentSnapshot. */
    audit: {
      executionMode: { type: String, default: null },
      executionAction: { type: String, default: null },
      executionMessage: { type: String, default: '' },
      executionError: { type: String, default: '' },
      executedAt: { type: Date, default: null },
      expectedSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    },
  },
  { timestamps: true }
);

MikrotikSyncJobSchema.index({ tenantId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model('MikrotikSyncJob', MikrotikSyncJobSchema);
