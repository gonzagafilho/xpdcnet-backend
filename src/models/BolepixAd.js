const mongoose = require('mongoose');

const BolepixAdSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    title: { type: String, trim: true, maxlength: 120, default: 'Banner promocional' },
    imageUrl: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: false, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true },
);

BolepixAdSchema.index({ tenantId: 1 }, { unique: true });
BolepixAdSchema.index({ tenantId: 1, isActive: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('BolepixAd', BolepixAdSchema);
