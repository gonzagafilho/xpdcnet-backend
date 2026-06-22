const mongoose = require('mongoose');

const MikrotikTelemetrySnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
      default: null,
    },

    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MikrotikServer',
      index: true,
      required: true,
    },

    serverName: {
      type: String,
      default: '',
      index: true,
    },

    cpuPercent: { type: Number, default: 0, index: true },
    memoryPercent: { type: Number, default: 0 },
    memoryFreeBytes: { type: Number, default: null },
    memoryTotalBytes: { type: Number, default: null },
    temperature: { type: Number, default: null },
    voltage: { type: Number, default: null },
    version: { type: String, default: '' },
    uptime: { type: String, default: '' },
    boardName: { type: String, default: '' },
    cpuCount: { type: Number, default: null },
    architectureName: { type: String, default: '' },
    interfaceTotal: { type: Number, default: 0 },
    interfaceRunning: { type: Number, default: 0 },
    pppOnline: { type: Number, default: 0 },

    interfaces: [
      {
        name: String,
        rxMbps: { type: Number, default: 0 },
        txMbps: { type: Number, default: 0 },
        running: { type: Boolean, default: true },
        disabled: { type: Boolean, default: false },
      },
    ],

    health: {
      type: String,
      enum: ['healthy', 'warning', 'critical'],
      default: 'healthy',
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

MikrotikTelemetrySnapshotSchema.index({ createdAt: -1, serverId: 1 });
MikrotikTelemetrySnapshotSchema.index({ tenantId: 1, serverId: 1, createdAt: -1 });

module.exports = mongoose.model(
  'MikrotikTelemetrySnapshot',
  MikrotikTelemetrySnapshotSchema,
);
