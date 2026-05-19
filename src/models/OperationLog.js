const mongoose = require('mongoose');

const OperationLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true, trim: true, maxlength: 120, index: true },
    targetType: { type: String, required: true, trim: true, maxlength: 64 },
    targetId: { type: String, default: '', trim: true, maxlength: 64 },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ['success', 'error'],
      required: true,
      index: true,
    },
    errorMessage: { type: String, default: '', maxlength: 2000 },
    requestId: { type: String, default: '', trim: true, maxlength: 64 },
  },
  { timestamps: true },
);

OperationLogSchema.index({ tenantId: 1, createdAt: -1 });
OperationLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model('OperationLog', OperationLogSchema);
