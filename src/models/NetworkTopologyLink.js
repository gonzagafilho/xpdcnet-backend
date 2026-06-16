const mongoose = require('mongoose');

const NetworkTopologyLinkSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    fromNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkNode',
      required: true,
      index: true,
    },

    toNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkNode',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['BACKBONE', 'POP_UPLINK', 'PTP', 'FIBER', 'WIRELESS', 'VPN', 'OTHER'],
      default: 'OTHER',
      index: true,
    },

    status: {
      type: String,
      enum: ['unknown', 'online', 'degraded', 'offline'],
      default: 'unknown',
      index: true,
    },

    capacityMbps: {
      type: Number,
      default: 0,
    },

    currentRxMbps: {
      type: Number,
      default: 0,
    },

    currentTxMbps: {
      type: Number,
      default: 0,
    },

    latencyMs: {
      type: Number,
      default: null,
    },

    packetLossPct: {
      type: Number,
      default: null,
    },

    healthScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
      index: true,
    },

    healthLevel: {
      type: String,
      enum: ['healthy', 'warning', 'critical', 'offline'],
      default: 'healthy',
      index: true,
    },

    lastSampleAt: {
      type: Date,
      default: null,
      index: true,
    },

    config: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

NetworkTopologyLinkSchema.index({ tenantId: 1, code: 1 }, { unique: true });
NetworkTopologyLinkSchema.index({ tenantId: 1, status: 1 });
NetworkTopologyLinkSchema.index({ tenantId: 1, healthLevel: 1 });

module.exports = mongoose.model('NetworkTopologyLink', NetworkTopologyLinkSchema);
