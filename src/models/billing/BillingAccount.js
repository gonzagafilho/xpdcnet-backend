const mongoose = require('mongoose');

const BillingAccountSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingProvider', required: true, index: true },
    label: { type: String, required: true, trim: true },
    externalAccountId: { type: String, default: '', trim: true },
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true },
    credentials: { type: mongoose.Schema.Types.Mixed, default: null },
    config: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

BillingAccountSchema.index({ tenantId: 1, providerId: 1, label: 1 }, { unique: true });

module.exports = mongoose.model('BillingAccount', BillingAccountSchema);
