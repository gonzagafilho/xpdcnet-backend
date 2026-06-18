const mongoose = require('mongoose');

const PppoeLiveSnapshotSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    pppoeUsername: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, enum: ['online', 'offline', 'unknown'], default: 'unknown', index: true },
    currentIp: { type: String, default: null },
    uptime: { type: String, default: null },
    service: { type: String, default: null },
    callerId: { type: String, default: null },
    downloadBytes: { type: Number, default: 0 },
    uploadBytes: { type: Number, default: 0 },
    downloadMbps: { type: Number, default: 0 },
    uploadMbps: { type: Number, default: 0 },
    pingMs: { type: Number, default: 0 },
    jitterMs: { type: Number, default: 0 },
    packetLoss: { type: Number, default: 0 },
    source: { type: String, default: 'mikrotik', index: true },
    lastUpdateAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, versionKey: false },
);

PppoeLiveSnapshotSchema.index({ tenantId: 1, pppoeUsername: 1 }, { unique: true });
PppoeLiveSnapshotSchema.index({ lastUpdateAt: -1 });

module.exports = mongoose.model('PppoeLiveSnapshot', PppoeLiveSnapshotSchema);
