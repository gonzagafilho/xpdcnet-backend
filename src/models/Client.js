const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // Dados do cliente
    fullName: { type: String, required: true },
    document: { type: String, default: '' }, // CPF/CNPJ (vamos validar depois)
    phone: { type: String, default: '' },
    email: { type: String, default: '' },

    // Endereço
    address: {
      zip: { type: String, default: '' },
      street: { type: String, default: '' },
      number: { type: String, default: '' },
      neighborhood: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' }, // UF
      reference: { type: String, default: '' },
    },

    // Geolocalização
    geo: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    // Plano e cobrança
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },
    monthlyPrice: { type: Number, required: true }, // trava o valor do cliente (mesmo se o plano mudar depois)
    dueDay: { type: Number, default: 10 }, // dia do vencimento (1..28)

    // Credenciais de acesso (PPPoE/Hotspot)
    access: {
      authType: { type: String, enum: ['pppoe', 'hotspot'], default: 'pppoe' },
      username: { type: String, required: true },
      password: { type: String, required: true },
    },

    status: { type: String, enum: ['active', 'suspended', 'cancelled'], default: 'active' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

// username único por tenant
ClientSchema.index({ tenantId: 1, 'access.username': 1 }, { unique: true });

module.exports = mongoose.model('Client', ClientSchema);
