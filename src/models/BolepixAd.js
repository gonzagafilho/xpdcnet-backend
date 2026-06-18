const mongoose = require('mongoose');

const CATEGORIES = ['institucional', 'upgrade', 'promocao', 'indique_ganhe', 'patrocinado'];

const BolepixAdSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: 'Banner promocional' },
    imageUrl: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: false, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    priority: { type: Number, min: 1, max: 100, default: 1 },
    impressions: { type: Number, min: 0, default: 0 },
    clicks: { type: Number, min: 0, default: 0 },
    category: { type: String, enum: CATEGORIES, default: 'institucional', index: true },
    sponsorName: { type: String, trim: true, maxlength: 120, default: '' },
  },
  { timestamps: true },
);

BolepixAdSchema.index({ tenantId: 1, isActive: 1, startsAt: 1, endsAt: 1 });
BolepixAdSchema.index({ tenantId: 1, priority: -1, createdAt: -1 });

module.exports = mongoose.model('BolepixAd', BolepixAdSchema);
module.exports.CATEGORIES = CATEGORIES;
