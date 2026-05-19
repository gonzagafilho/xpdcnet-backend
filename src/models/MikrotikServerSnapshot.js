const mongoose = require('mongoose');

/**
 * Histórico leve de consultas de monitoramento (sem séries temporais pesadas).
 * Preenchido ao consultar GET /mikrotik/servers/:id/monitoring; retenção curta por servidor.
 */
const TopIfSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    rx: { type: String, default: '' },
    tx: { type: String, default: '' },
  },
  { _id: false },
);

/** Amostra leve por porta (para histórico de tráfego no painel). */
const InterfaceTrafficSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    rxBytes: { type: String, default: '' },
    txBytes: { type: String, default: '' },
  },
  { _id: false },
);

const MikrotikServerSnapshotSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikServer', required: true, index: true },
    online: { type: Boolean, required: true },
    cpuPercent: { type: Number, default: null },
    memoryTotalBytes: { type: Number, default: null },
    memoryFreeBytes: { type: Number, default: null },
    diskTotalBytes: { type: Number, default: null },
    diskFreeBytes: { type: Number, default: null },
    totalClients: { type: Number, default: 0 },
    pppSecretCount: { type: Number, default: null },
    interfaceCount: { type: Number, default: 0 },
    activePppTotal: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    topInterfaces: { type: [TopIfSchema], default: [] },
    interfaceTraffic: { type: [InterfaceTrafficSchema], default: [] },
    generatedAt: { type: Date, required: true, index: true },
  },
  { timestamps: false },
);

MikrotikServerSnapshotSchema.index({ tenantId: 1, serverId: 1, generatedAt: -1 });

module.exports = mongoose.model('MikrotikServerSnapshot', MikrotikServerSnapshotSchema);
