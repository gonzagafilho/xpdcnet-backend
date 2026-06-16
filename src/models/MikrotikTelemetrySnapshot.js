const mongoose = require('mongoose');

const MikrotikTelemetrySnapshotSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkNode',
      index: true,
      required: true,
    },

    serverName: {
      type: String,
      default: '',
      index: true,
    },

    cpuPercent: {
      type: Number,
      default: 0,
      index: true,
    },

    memoryPercent: {
      type: Number,
      default: 0,
    },

    temperature: {
      type: Number,
      default: 0,
    },

    pppOnline: {
      type: Number,
      default: 0,
    },

    interfaces: [
      {
        name: String,

        rxMbps: {
          type: Number,
          default: 0,
        },

        txMbps: {
          type: Number,
          default: 0,
        },

        running: {
          type: Boolean,
          default: true,
        },
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

MikrotikTelemetrySnapshotSchema.index({
  createdAt: -1,
  serverId: 1,
});

module.exports = mongoose.model(
  'MikrotikTelemetrySnapshot',
  MikrotikTelemetrySnapshotSchema,
);
