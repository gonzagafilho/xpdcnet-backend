const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /**
     * Opcional: força execução neste node (sobreposta à do MikrotikServer).
     * Null = herda apenas de mikrotik.serverId → MikrotikServer.networkNodeId (ou legado sem node).
     */
    networkNodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkNode', default: null, index: true },

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

    // Contrato comercial (opcional — evolução aditiva)
    contract: {
      paymentMethod: { type: String, default: '' },
      contractModel: { type: String, default: '' },
      discount: { type: String, default: '' },
      surcharge: { type: String, default: '' },
      /** @deprecated Reservado comercial; a automação financeira usa Tenant.financePolicy (grace, etc.), não estes campos. */
      pendingDays: { type: Number, default: null },
      /** @deprecated Reservado comercial; não ligado ao rollup nem ao MikroTik nesta versão. */
      blockDays: { type: Number, default: null },
      notes: { type: String, default: '' },
    },

    // Parâmetros de rede / auth alargada (separado de access PPPoE)
    networkAccess: {
      server: { type: String, default: '' },
      ip: { type: String, default: '' },
      mac: { type: String, default: '' },
      tags: { type: String, default: '' },
      operationalStatus: { type: String, default: '' },
    },

    // MikroTik por cliente (opcional; plano pode ter defaults em Plan.mikrotik)
    mikrotik: {
      enabled: { type: Boolean, default: false },
      /** Vínculo canónico ao equipamento (GET /mikrotik/servers). */
      serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikServer', default: null, index: true },
      profile: { type: String, default: '' },
      comment: { type: String, default: '' },
      /** @deprecated Preferir mikrotik.sync.lastSuccessAt quando a sync existir. */
      syncedAt: { type: Date, default: null },
      /** Estado preparado para futura camada de sync (sem execução RouterOS ainda). */
      sync: {
        state: {
          type: String,
          enum: ['never', 'pending', 'in_sync', 'drift', 'error', 'skipped'],
          default: 'never',
        },
        lastAttemptAt: { type: Date, default: null },
        lastSuccessAt: { type: Date, default: null },
        lastErrorMessage: { type: String, default: '' },
      },
    },

    /**
     * Liberação por confiança (ex.: inadimplente mantido com serviço até data).
     * Não substitui blocked/disabled; auditável no cadastro.
     */
    trustRelease: {
      enabled: { type: Boolean, default: false },
      until: { type: Date, default: null },
      reason: { type: String, default: '' },
      setAt: { type: Date, default: null },
      setBy: { type: String, default: '' },
      /** Idempotência do scheduler de expiração (mesmo valor que `until` quando já enfileirado). */
      lastExpiryEnqueueForUntil: { type: Date, default: null },
    },

    // Credenciais de acesso (PPPoE/Hotspot)
    access: {
      authType: { type: String, enum: ['pppoe', 'hotspot'], default: 'pppoe' },
      username: { type: String, required: true },
      password: { type: String, required: true },
    },

    // Estados legados (active, suspended, cancelled) mantidos; novos valores evolutivos para controle operacional.
    status: {
      type: String,
      enum: ['active', 'suspended', 'cancelled', 'pending', 'delinquent', 'blocked', 'disabled'],
      default: 'active',
    },
    notes: { type: String, default: '' },

    /**
     * Metadados do motor financeiro automático (anti-flapping, auditoria leve).
     * Não substitui logs de job/sync.
     */
    financeAutomation: {
      lastAutomaticTransitionAt: { type: Date, default: null },
      lastAutomaticTransitionReason: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

// username único por tenant
ClientSchema.index({ tenantId: 1, 'access.username': 1 }, { unique: true });

module.exports = mongoose.model('Client', ClientSchema);
