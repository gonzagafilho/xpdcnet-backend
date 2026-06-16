const mongoose = require('mongoose');

const CustomerOtpSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null, index: true },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1 },
  },
  { timestamps: true },
);

CustomerOtpSchema.index({ tenantId: 1, clientId: 1, phone: 1, createdAt: -1 });
CustomerOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('CustomerOtp', CustomerOtpSchema);
