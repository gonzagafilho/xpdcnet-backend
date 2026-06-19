const mongoose = require('mongoose');

const ImportErrorSchema = new mongoose.Schema(
  {
    row: { type: Number, default: null },
    field: { type: String, default: '' },
    code: { type: String, default: '' },
    message: { type: String, required: true },
  },
  { _id: false },
);

const DataImportJobSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    type: { type: String, enum: ['customers', 'pppoe', 'contracts'], default: 'customers', index: true },
    source: { type: String, enum: ['csv', 'xlsx', 'json', 'manual'], required: true, index: true },
    originalFilename: { type: String, required: true, trim: true },
    fileHash: { type: String, required: true, index: true },
    status: { type: String, enum: ['preview', 'completed', 'failed'], default: 'preview', index: true },
    targetServerId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikrotikServer', required: true, index: true },
    targetServerName: { type: String, required: true, trim: true },
    targetNetworkNodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkNode', default: null },
    targetNetworkNodeName: { type: String, default: '' },
    detectedColumns: { type: [String], default: [] },
    columnMapping: { type: Map, of: String, default: {} },
    previewRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    normalizedRows: { type: [mongoose.Schema.Types.Mixed], default: [], select: false },
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    duplicateRows: { type: Number, default: 0 },
    invalidRows: { type: Number, default: 0 },
    matchedPppoeRows: { type: Number, default: 0 },
    importedRows: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },
    errorItems: { type: [ImportErrorSchema], default: [] },
    createdBy: { type: String, default: '' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DataImportJobSchema.index({ tenantId: 1, createdAt: -1 });
DataImportJobSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('DataImportJob', DataImportJobSchema);
