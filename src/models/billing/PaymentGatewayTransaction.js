const mongoose = require('mongoose');

const PaymentGatewayTransactionSchema = new mongoose.Schema(
  {
    gateway: {
      type: String,
      enum: ['mercadopago', 'cora'],
      required: true,
      index: true,
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BillingInvoice',
      required: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BillingCustomer',
      index: true,
    },

    externalId: {
      type: String,
      index: true,
    },

    externalReference: {
      type: String,
      index: true,
    },

    status: {
      type: String,
      default: 'pending',
      index: true,
    },

    amountCents: {
      type: Number,
      required: true,
    },

    dueDate: Date,

    qrCode: String,
    qrCodeBase64: String,
    ticketUrl: String,

    paidAt: Date,

    rawCreateResponse: Object,
    rawWebhookPayload: Object,
    rawLastStatusResponse: Object,

    lastCheckedAt: Date,
    webhookReceivedAt: Date,

    errorMessage: String,
  },
  { timestamps: true }
);

PaymentGatewayTransactionSchema.index(
  { gateway: 1, externalId: 1 },
  { unique: true, sparse: true }
);

PaymentGatewayTransactionSchema.index(
  { invoiceId: 1, gateway: 1, status: 1 }
);

module.exports = mongoose.model(
  'PaymentGatewayTransaction',
  PaymentGatewayTransactionSchema
);
