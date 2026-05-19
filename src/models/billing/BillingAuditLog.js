const mongoose = require('mongoose');

const BillingAuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    billingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingAccount', default: null, index: true },
    billingInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingInvoice', default: null, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    providerCode: { type: String, default: '', trim: true, index: true },
    adapterKey: { type: String, default: '', trim: true },
    eventType: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: ['success', 'failed', 'noop', 'ignored'], required: true, index: true },
    errorSummary: { type: String, default: '', trim: true },
    actorType: { type: String, enum: ['user', 'system', 'webhook', 'provider'], default: 'system' },
    actorLabel: { type: String, default: '', trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

BillingAuditLogSchema.index({ tenantId: 1, createdAt: -1 });
BillingAuditLogSchema.index({ tenantId: 1, billingInvoiceId: 1, createdAt: -1 });

module.exports = mongoose.model('BillingAuditLog', BillingAuditLogSchema);
