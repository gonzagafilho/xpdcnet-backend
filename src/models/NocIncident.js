const mongoose = require('mongoose');

const NocIncidentSchema = new mongoose.Schema(
  {
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'warning',
      index: true,
    },

    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      index: true,
    },

    source: {
      type: String,
      default: 'noc',
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      default: '',
    },

    fingerprint: {
      type: String,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    resolvedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

NocIncidentSchema.index({
  status: 1,
  severity: 1,
  startedAt: -1,
});

module.exports = mongoose.model(
  'NocIncident',
  NocIncidentSchema,
);
