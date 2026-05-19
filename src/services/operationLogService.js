const mongoose = require('mongoose');
const OperationLog = require('../models/OperationLog');
const ApiError = require('../errors/ApiError');

function scrub(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  try {
    const clone = JSON.parse(JSON.stringify(value));
    const redactKeys = /password|secret|token|authorization|pppoe|routerapi|credential/i;
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((item) => walk(item));
        return;
      }
      for (const k of Object.keys(obj)) {
        if (redactKeys.test(k)) {
          obj[k] = '[redacted]';
        } else if (typeof obj[k] === 'object' && obj[k] !== null) {
          walk(obj[k]);
        }
      }
    }
    walk(clone);
    return clone;
  } catch (_) {
    return { _scrub: 'unserializable' };
  }
}

function mapLogRow(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    tenantId: doc.tenantId != null ? String(doc.tenantId) : null,
    userId: doc.userId != null ? String(doc.userId) : null,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId || '',
    payload: doc.payload != null ? doc.payload : null,
    result: doc.result != null ? doc.result : null,
    status: doc.status,
    errorMessage: doc.errorMessage || '',
    requestId: doc.requestId || '',
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

/**
 * Lista paginada para NOC / suporte (tenant actual).
 * @param {string|mongoose.Types.ObjectId} tenantId
 * @param {object} query — action, targetType, status, from, to, page, pageSize, tenantSlug
 */
exports.listPaginated = async (tenantId, query = {}) => {
  const tid = mongoose.Types.ObjectId.isValid(String(tenantId)) ? new mongoose.Types.ObjectId(String(tenantId)) : null;
  if (!tid) throw ApiError.badRequest('Tenant inválido');

  if (query.tenantSlug != null && String(query.tenantSlug).trim() !== '') {
    const Tenant = require('../models/Tenant');
    const t = await Tenant.findById(tid).select('slug').lean();
    if (!t || String(t.slug) !== String(query.tenantSlug).trim()) {
      throw ApiError.badRequest('tenantSlug não corresponde ao tenant da sessão.');
    }
  }

  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || query.limit || '25'), 10) || 25));

  const filter = { tenantId: tid };
  if (query.action != null && String(query.action).trim() !== '') {
    filter.action = String(query.action).trim().slice(0, 120);
  }
  if (query.targetType != null && String(query.targetType).trim() !== '') {
    filter.targetType = String(query.targetType).trim().slice(0, 64);
  }
  if (query.status === 'success' || query.status === 'error') {
    filter.status = query.status;
  }
  if (query.from != null || query.to != null) {
    filter.createdAt = {};
    if (query.from) {
      const d = new Date(query.from);
      if (!Number.isNaN(d.getTime())) filter.createdAt.$gte = d;
    }
    if (query.to) {
      const d = new Date(query.to);
      if (!Number.isNaN(d.getTime())) filter.createdAt.$lte = d;
    }
    if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
  }

  const [rows, total] = await Promise.all([
    OperationLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    OperationLog.countDocuments(filter),
  ]);

  return {
    items: rows.map(mapLogRow),
    total,
    page,
    pageSize,
  };
};

exports.logOperation = async (params) => {
  const tid = mongoose.Types.ObjectId.isValid(String(params.tenantId))
    ? new mongoose.Types.ObjectId(String(params.tenantId))
    : null;
  if (!tid) return null;

  const userId =
    params.userId != null && mongoose.Types.ObjectId.isValid(String(params.userId))
      ? new mongoose.Types.ObjectId(String(params.userId))
      : null;

  const requestId =
    params.req && params.req.headers && params.req.headers['x-request-id']
      ? String(params.req.headers['x-request-id']).slice(0, 64)
      : '';

  try {
    return await OperationLog.create({
      tenantId: tid,
      userId,
      action: String(params.action || 'unknown').slice(0, 120),
      targetType: String(params.targetType || 'unknown').slice(0, 64),
      targetId: params.targetId != null ? String(params.targetId).slice(0, 64) : '',
      payload: scrub(params.payload),
      result: params.result !== undefined ? scrub(params.result) : null,
      status: params.status === 'error' ? 'error' : 'success',
      errorMessage: params.errorMessage != null ? String(params.errorMessage).slice(0, 2000) : '',
      requestId,
    });
  } catch (err) {
    console.error('[operationLog] persist failed:', err && err.message ? err.message : err);
    return null;
  }
};
