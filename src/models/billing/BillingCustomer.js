const mongoose = require('mongoose');

const BillingCustomerSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    billingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    providerCustomerId: { type: String, required: true, trim: true },
    payloadSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

BillingCustomerSchema.index({ tenantId: 1, billingAccountId: 1, clientId: 1 }, { unique: true });
BillingCustomerSchema.index({ tenantId: 1, providerCustomerId: 1 });

module.exports = mongoose.model('BillingCustomer', BillingCustomerSchema);
