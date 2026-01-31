const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true }, // owner, admin, suporte, financeiro...
    permissions: { type: [String], default: [] }, // ex: ["clients:create","clients:read"]
  },
  { timestamps: true }
);

RoleSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Role', RoleSchema);
