const mongoose = require('mongoose');

const BillingSettlementSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    billingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    billingInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingInvoice', default: null, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },

    providerSettlementId: { type: String, default: '', trim: true },
    amount: { type: Number, default: 0 },
    feeAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    settledAt: { type: Date, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

BillingSettlementSchema.index({ tenantId: 1, billingAccountId: 1, providerSettlementId: 1 });

module.exports = mongoose.model('BillingSettlement', BillingSettlementSchema);
