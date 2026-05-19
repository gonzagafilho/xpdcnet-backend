const mongoose = require('mongoose');

const BillingWebhookEventSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    billingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    providerEventId: { type: String, required: true, trim: true },
    eventType: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['received', 'processed', 'ignored', 'failed'],
      default: 'received',
      index: true,
    },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
    parsed: { type: mongoose.Schema.Types.Mixed, default: null },
    processedAt: { type: Date, default: null },
    errorMessage: { type: String, default: '' },
    /** Hash mínimo do pedido (cabeçalhos relevantes + comprimento do corpo) — idempotência/replay operacional. */
    requestFingerprint: { type: String, default: '', trim: true, index: true },
    sourceIp: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

BillingWebhookEventSchema.index({ tenantId: 1, billingAccountId: 1, providerEventId: 1 }, { unique: true });

module.exports = mongoose.model('BillingWebhookEvent', BillingWebhookEventSchema);
