const mongoose = require('mongoose');

const SupportTicketSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    protocol: { type: String, required: true, trim: true, unique: true, index: true },
  },
  { timestamps: true },
);

SupportTicketSchema.index({ tenantId: 1, clientId: 1, createdAt: -1 });
SupportTicketSchema.index({ tenantId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
