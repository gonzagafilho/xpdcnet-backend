const mongoose = require("mongoose");

const NetworkNodeMetricInterfaceSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    type: { type: String, default: "" },
    running: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    rxMbps: { type: Number, default: 0 },
    txMbps: { type: Number, default: 0 },
    rxByte: { type: Number, default: 0 },
    txByte: { type: Number, default: 0 },
    macAddress: { type: String, default: "" },
  },
  { _id: false }
);

const NetworkNodeMetricSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      index: true,
      required: true,
    },

    nodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NetworkNode",
      index: true,
      required: true,
    },

    sampledAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    status: {
      type: String,
      default: "online",
    },

    hostname: {
      type: String,
      default: "",
    },

    mikrotikName: {
      type: String,
      default: "",
    },

    cpuLoad: {
      type: Number,
      default: 0,
    },

    memoryFreeBytes: {
      type: Number,
      default: 0,
    },

    totalRxMbps: {
      type: Number,
      default: 0,
    },

    totalTxMbps: {
      type: Number,
      default: 0,
    },

    interfaceCount: {
      type: Number,
      default: 0,
    },

    pppOnlineCount: {
      type: Number,
      default: 0,
    },

    interfaces: {
      type: [NetworkNodeMetricInterfaceSchema],
      default: [],
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

NetworkNodeMetricSchema.index({
  tenantId: 1,
  nodeId: 1,
  sampledAt: -1,
});

module.exports = mongoose.model(
  "NetworkNodeMetric",
  NetworkNodeMetricSchema
);
