const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // ex: dcnet
    isActive: { type: Boolean, default: true },
    financePolicy: {
      financeAutomationEnabled: { type: Boolean, default: true },
      financeGraceDays: { type: Number, default: 0, min: 0, max: 120 },
      financeMinOverdueInvoices: { type: Number, default: 1, min: 1, max: 20 },
      financeCutoffWindowEnabled: { type: Boolean, default: false },
      financeCutoffStartHour: { type: Number, default: 0, min: 0, max: 23 },
      financeCutoffEndHour: { type: Number, default: 23, min: 0, max: 23 },
      financeAutoReactivateWhenClear: { type: Boolean, default: true },
      /**
       * Janela mínima (minutos) entre transições automáticas de status pelo rollup.
       * 0 = anti-flapping desligado para esse tenant.
       */
      financeAutomationMinHoldMinutes: { type: Number, default: 15, min: 0, max: 1440 },
      financeTimezone: { type: String, default: 'America/Sao_Paulo' },
      updatedBy: { type: String, default: '' },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', TenantSchema);
