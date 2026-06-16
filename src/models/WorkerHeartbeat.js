const mongoose = require('mongoose');

const WorkerHeartbeatSchema = new mongoose.Schema(
  {
    worker: {
      type: String,
      required: true,
      unique: true,
      index: true,
      enum: ['sync', 'finance', 'trust', 'telemetry', 'stale'],
    },
    status: {
      type: String,
      default: 'online',
      enum: ['online', 'degraded', 'offline'],
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastSuccessAt: {
      type: Date,
      default: null,
    },
    lastErrorAt: {
      type: Date,
      default: null,
    },
    lastErrorMessage: {
      type: String,
      default: '',
    },
    lastDurationMs: {
      type: Number,
      default: 0,
    },
    tickCount: {
      type: Number,
      default: 0,
    },
    successCount: {
      type: Number,
      default: 0,
    },
    errorCount: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('WorkerHeartbeat', WorkerHeartbeatSchema);
