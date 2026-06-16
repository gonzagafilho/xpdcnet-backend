const mongoose = require('mongoose');

const NetworkInterfaceInventorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    networkNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkNode',
      required: true,
      index: true,
    },

    commandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RemoteAgentCommand',
      default: null,
      index: true,
    },

    interfaceId: {
      type: String,
      default: '',
      index: true,
    },

    name: {
      type: String,
      default: '',
      index: true,
    },

    defaultName: {
      type: String,
      default: '',
    },

    type: {
      type: String,
      default: '',
      index: true,
    },

    macAddress: {
      type: String,
      default: '',
      index: true,
    },

    mtu: {
      type: Number,
      default: 0,
    },

    actualMtu: {
      type: Number,
      default: 0,
    },

    running: {
      type: Boolean,
      default: false,
      index: true,
    },

    disabled: {
      type: Boolean,
      default: false,
      index: true,
    },

    rxBytes: {
      type: Number,
      default: 0,
    },

    txBytes: {
      type: Number,
      default: 0,
    },

    prevRxBytes: {
      type: Number,
      default: 0,
    },

    prevTxBytes: {
      type: Number,
      default: 0,
    },

    prevSampleAt: {
      type: Date,
      default: null,
    },

    currentRxMbps: {
      type: Number,
      default: 0,
      index: true,
    },

    currentTxMbps: {
      type: Number,
      default: 0,
      index: true,
    },

    rxPackets: {
      type: Number,
      default: 0,
    },

    txPackets: {
      type: Number,
      default: 0,
    },

    linkDowns: {
      type: Number,
      default: 0,
    },

    lastLinkUpTime: {
      type: String,
      default: '',
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

NetworkInterfaceInventorySchema.index({
  tenantId: 1,
  networkNodeId: 1,
  name: 1,
}, {
  unique: true,
});

module.exports = mongoose.model(
  'NetworkInterfaceInventory',
  NetworkInterfaceInventorySchema,
);
