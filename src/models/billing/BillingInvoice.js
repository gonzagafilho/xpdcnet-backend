const mongoose = require('mongoose');

const BillingInvoiceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    billingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingAccount', required: true, index: true },
    billingCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingCustomer', default: null, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },

    providerChargeId: { type: String, required: true, trim: true },
    providerStatus: { type: String, default: '', trim: true },
    internalStatus: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'cancelled'],
      default: 'pending',
      index: true,
    },

    checkoutUrl: { type: String, default: '' },
    pixPayload: { type: String, default: '' },
    pixQrCodeUrl: { type: String, default: '' },
    boletoUrl: { type: String, default: '' },
    boletoBarcode: { type: String, default: '' },

    dueDate: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    amount: { type: Number, default: 0 },

    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

BillingInvoiceSchema.index({ tenantId: 1, billingAccountId: 1, providerChargeId: 1 }, { unique: true });
BillingInvoiceSchema.index({ tenantId: 1, invoiceId: 1, billingAccountId: 1 });

module.exports = mongoose.model('BillingInvoice', BillingInvoiceSchema, 'invoices');
