const mongoose = require('mongoose');

const ConcentratorAlertSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    concentratorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkConcentrator',
      required: true,
      index: true,
    },
    concentratorName: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['CPU_HIGH', 'RAM_HIGH', 'PPP_DROP', 'OFFLINE', 'TELEMETRY_STALE'],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['warning', 'critical'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    metricValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    thresholdValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    openedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ConcentratorAlertSchema.index({ tenantId: 1, status: 1, severity: 1 });
ConcentratorAlertSchema.index(
  { tenantId: 1, concentratorId: 1, type: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'open' },
  },
);
ConcentratorAlertSchema.index({ openedAt: -1 });

module.exports = mongoose.model('ConcentratorAlert', ConcentratorAlertSchema);
