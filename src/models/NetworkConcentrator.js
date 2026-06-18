const mongoose = require('mongoose');

const NETWORK_CONCENTRATOR_TYPES = [
  'mikrotik',
  'huawei_olt',
  'fiberhome_olt',
  'zte_olt',
  'intelbras',
  'generic_snmp',
  'generic_http',
  'other',
];

const NETWORK_CONCENTRATOR_PROTOCOLS = [
  'routeros',
  'snmp',
  'http',
  'ssh',
  'telnet',
  'other',
];

const NETWORK_CONCENTRATOR_STATUSES = [
  'unknown',
  'online',
  'offline',
  'auth_error',
  'timeout',
  'unsupported',
];

const NetworkConcentratorSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: NETWORK_CONCENTRATOR_TYPES,
      required: true,
      default: 'mikrotik',
      index: true,
    },
    agentNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NetworkNode',
      required: true,
      index: true,
    },
    host: { type: String, required: true, trim: true },
    port: { type: Number, required: true, min: 1, max: 65535, default: 8728 },
    username: { type: String, required: true, trim: true },
    passwordEncrypted: { type: String, required: true, select: false },
    protocol: {
      type: String,
      enum: NETWORK_CONCENTRATOR_PROTOCOLS,
      required: true,
      default: 'routeros',
    },
    tls: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: NETWORK_CONCENTRATOR_STATUSES,
      default: 'unknown',
      index: true,
    },
    lastTestAt: { type: Date, default: null },
    lastErrorSafe: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

NetworkConcentratorSchema.index({ tenantId: 1, name: 1 });
NetworkConcentratorSchema.index({ tenantId: 1, agentNodeId: 1 });
NetworkConcentratorSchema.index({ tenantId: 1, type: 1 });

module.exports = mongoose.model('NetworkConcentrator', NetworkConcentratorSchema);
module.exports.NETWORK_CONCENTRATOR_TYPES = NETWORK_CONCENTRATOR_TYPES;
module.exports.NETWORK_CONCENTRATOR_PROTOCOLS = NETWORK_CONCENTRATOR_PROTOCOLS;
module.exports.NETWORK_CONCENTRATOR_STATUSES = NETWORK_CONCENTRATOR_STATUSES;
