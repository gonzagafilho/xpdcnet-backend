const mongoose = require('mongoose');

const NocSnapshotSchema = new mongoose.Schema(
  {
    pending: { type: Number, default: 0, index: true },
    processing: { type: Number, default: 0, index: true },
    failed: { type: Number, default: 0, index: true },
    stale: { type: Number, default: 0, index: true },

    pressurePercent: { type: Number, default: 0 },
    throughputPerMinute: { type: Number, default: 0 },

    agents: {
      total: { type: Number, default: 0 },
      online: { type: Number, default: 0 },
      offline: { type: Number, default: 0 },
    },

    workers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

NocSnapshotSchema.index({ createdAt: -1 });

module.exports = mongoose.model('NocSnapshot', NocSnapshotSchema);
