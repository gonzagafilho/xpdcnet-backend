const mongoose = require('mongoose');

const BillingProviderSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    adapterKey: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    config: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

BillingProviderSchema.index({ tenantId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('BillingProvider', BillingProviderSchema);
