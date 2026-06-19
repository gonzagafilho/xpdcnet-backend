const mongoose = require('mongoose');

const ClientAccessSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikServer', required: true, index: true },
    networkNodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkNode', default: null, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },
    authType: { type: String, enum: ['pppoe'], default: 'pppoe', required: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    status: { type: String, enum: ['pending', 'active', 'suspended', 'disabled'], default: 'pending', index: true },
    source: { type: String, enum: ['import', 'manual', 'routeros'], required: true, default: 'manual' },
    importedFrom: { type: String, default: '', trim: true },
    importedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ClientAccessSchema.index({ tenantId: 1, username: 1 }, { unique: true });
ClientAccessSchema.index({ tenantId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model('ClientAccess', ClientAccessSchema);
