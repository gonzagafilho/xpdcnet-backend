const mongoose = require('mongoose');

const CustomerTrustedDeviceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    document: { type: String, required: true, index: true },
    phone: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

CustomerTrustedDeviceSchema.index({ tenantId: 1, clientId: 1, document: 1, phone: 1, expiresAt: 1 });
CustomerTrustedDeviceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CustomerTrustedDevice', CustomerTrustedDeviceSchema);
