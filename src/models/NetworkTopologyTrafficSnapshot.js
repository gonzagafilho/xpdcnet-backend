const mongoose = require('mongoose');

const NetworkTopologyTrafficSnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    linkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkTopologyLink',
      required: true,
      index: true,
    },

    linkCode: {
      type: String,
      default: '',
      index: true,
    },

    linkName: {
      type: String,
      default: '',
    },

    rxMbps: {
      type: Number,
      default: 0,
      index: true,
    },

    txMbps: {
      type: Number,
      default: 0,
      index: true,
    },

    totalMbps: {
      type: Number,
      default: 0,
      index: true,
    },

    capacityMbps: {
      type: Number,
      default: 0,
    },

    utilizationPct: {
      type: Number,
      default: 0,
      index: true,
    },

    status: {
      type: String,
      enum: ['online', 'degraded', 'offline', 'unknown'],
      default: 'unknown',
      index: true,
    },

    healthLevel: {
      type: String,
      enum: ['healthy', 'warning', 'critical', 'offline'],
      default: 'healthy',
      index: true,
    },

    isAlerted: {
      type: Boolean,
      default: false,
      index: true,
    },

    alertType: {
      type: String,
      default: null,
      index: true,
    },

    sampledAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

NetworkTopologyTrafficSnapshotSchema.index({
  tenantId: 1,
  linkId: 1,
  sampledAt: -1,
});

module.exports = mongoose.model(
  'NetworkTopologyTrafficSnapshot',
  NetworkTopologyTrafficSnapshotSchema,
);
