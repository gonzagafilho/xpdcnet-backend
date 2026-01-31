const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    name: { type: String, required: true },          // "300 Mbps"
    speedMbps: { type: Number, required: true },     // 300
    price: { type: Number, required: true },         // 78.99
    billingCycle: { type: String, enum: ['monthly', 'weekly', 'daily'], default: 'monthly' },

    authType: { type: String, enum: ['pppoe', 'hotspot'], default: 'pppoe' },

    // Base para integração Mikrotik (vamos evoluir no módulo Mikrotik)
    mikrotik: {
      profile: { type: String, default: '' },        // nome do profile no mikrotik
      rateLimit: { type: String, default: '' },      // "300M/300M" ou "300M/50M" etc.
      priority: { type: Number, default: 8 },        // 1..8 (mikrotik)
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

PlanSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Plan', PlanSchema);
