// src/models/Admin.js
const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", index: true }, // ✅ se você usa tenant
    nome: { type: String, required: true },
    email: { type: String, required: true, index: true },
    senhaHash: { type: String, required: true },

    role: { type: String, enum: ["superadmin", "admin"], default: "admin" },

    // ✅ RESET DE SENHA
    resetPasswordTokenHash: { type: String, default: null },
    resetPasswordExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Se for multi-tenant, esse índice ajuda a evitar emails iguais em tenants diferentes
AdminSchema.index({ tenantId: 1, email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Admin", AdminSchema);