const mongoose = require("mongoose");

const NetworkIncidentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },

    nodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NetworkNode",
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      index: true,
    },

    severity: {
      type: String,
      enum: ["info", "warning", "critical", "fatal"],
      default: "info",
      index: true,
    },

    status: {
      type: String,
      enum: ["open", "resolved", "muted"],
      default: "open",
      index: true,
    },

    title: String,

    message: String,

    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    lastSeenAt: {
      type: Date,
      default: Date.now,
    },

    resolvedAt: Date,

    fingerprint: {
      type: String,
      index: true,
    },

    source: {
      type: String,
      default: "agent",
    },

    metadata: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

NetworkIncidentSchema.index({
  tenantId: 1,
  nodeId: 1,
  status: 1,
  startedAt: -1,
});

module.exports = mongoose.model(
  "NetworkIncident",
  NetworkIncidentSchema
);
