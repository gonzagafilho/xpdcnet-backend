const mongoose = require('mongoose');

const BillingPolicySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true, index: true },
    billingEnabled: { type: Boolean, default: false },
    autoIssueOnGenerateMonth: { type: Boolean, default: false },
    autoSyncInvoiceStatus: { type: Boolean, default: true },
    defaultBillingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingAccount', default: null },
    webhookSecretHint: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('BillingPolicy', BillingPolicySchema);
