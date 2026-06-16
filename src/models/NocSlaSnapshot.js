const mongoose = require('mongoose');

const NocSlaSnapshotSchema = new mongoose.Schema(
  {
    uptimePercent24h: {
      type: Number,
      default: 100,
      index: true,
    },

    degradedEvents24h: {
      type: Number,
      default: 0,
    },

    criticalIncidents24h: {
      type: Number,
      default: 0,
    },

    openIncidents: {
      type: Number,
      default: 0,
    },

    mttrMinutes: {
      type: Number,
      default: 0,
    },

    mtbfMinutes: {
      type: Number,
      default: 0,
    },

    availability: {
      type: String,
      enum: ['healthy', 'degraded', 'critical'],
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

NocSlaSnapshotSchema.index({ createdAt: -1 });

module.exports = mongoose.model(
  'NocSlaSnapshot',
  NocSlaSnapshotSchema,
);
