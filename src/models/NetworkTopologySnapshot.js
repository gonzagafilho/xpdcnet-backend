const mongoose = require('mongoose');

const NetworkTopologySnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    sampledAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    totalNodes: {
      type: Number,
      default: 0,
    },

    onlineNodes: {
      type: Number,
      default: 0,
    },

    offlineNodes: {
      type: Number,
      default: 0,
    },

    degradedNodes: {
      type: Number,
      default: 0,
    },

    totalLinks: {
      type: Number,
      default: 0,
    },

    onlineLinks: {
      type: Number,
      default: 0,
    },

    degradedLinks: {
      type: Number,
      default: 0,
    },

    offlineLinks: {
      type: Number,
      default: 0,
    },

    avgHealthScore: {
      type: Number,
      default: 100,
    },

    topologyHealthLevel: {
      type: String,
      enum: ['healthy', 'warning', 'critical', 'offline'],
      default: 'healthy',
      index: true,
    },

    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

NetworkTopologySnapshotSchema.index({ tenantId: 1, sampledAt: -1 });

module.exports = mongoose.model('NetworkTopologySnapshot', NetworkTopologySnapshotSchema);
