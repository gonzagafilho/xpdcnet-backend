const mongoose = require('mongoose');

const PartnerAdSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, trim: true, maxlength: 80, index: true },
    imageUrl: { type: String, required: true, trim: true },
    whatsapp: { type: String, trim: true, maxlength: 40, default: '' },
    website: { type: String, trim: true, maxlength: 500, default: '' },
    priority: { type: Number, min: 1, max: 100, default: 1 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },
    impressions: { type: Number, min: 0, default: 0 },
    clicks: { type: Number, min: 0, default: 0 },
    lastDisplayedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PartnerAdSchema.index({ tenantId: 1, isActive: 1, startsAt: 1, endsAt: 1 });
PartnerAdSchema.index({ tenantId: 1, priority: -1, createdAt: -1 });

module.exports = mongoose.model('PartnerAd', PartnerAdSchema);
