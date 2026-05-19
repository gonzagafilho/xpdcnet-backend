const mongoose = require('mongoose');

/**
 * Cobrança mensal / fatura mínima operacional (sem gateway, boleto ou conciliação).
 * Vinculada a Client e Plan do mesmo tenant.
 */
const InvoiceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },

    amount: { type: Number, required: true },
    dueDate: { type: Date, required: true },

    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'cancelled'],
      default: 'pending',
    },

    paidAt: { type: Date, default: null },

    /** Competência no formato YYYY-MM (ex.: 2026-04) */
    competence: { type: String, required: true, trim: true },

    description: { type: String, default: '' },
  },
  { timestamps: true }
);

InvoiceSchema.index({ tenantId: 1, dueDate: -1 });
InvoiceSchema.index({ tenantId: 1, status: 1 });
/**
 * Uma cobrança por (tenant, competência, cliente). Evita duplicidade e corrida em generate-month.
 * Migração: se já existirem duplicatas históricas, a criação/atualização deste índice único no Mongo
 * falha até deduplicar manualmente (ex.: agregar por tenantId+competence+clientId com contagem > 1).
 */
InvoiceSchema.index({ tenantId: 1, competence: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('Invoice', InvoiceSchema);
