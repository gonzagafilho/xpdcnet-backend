const mongoose = require('mongoose');
const ApiError = require('../../errors/ApiError');
const BillingInvoice = require('../../models/billing/BillingInvoice');
const BillingWebhookEvent = require('../../models/billing/BillingWebhookEvent');
const BillingSettlement = require('../../models/billing/BillingSettlement');
const Invoice = require('../../models/Invoice');
const BillingAuditLog = require('../../models/billing/BillingAuditLog');

function oid(tenantId) {
  return new mongoose.Types.ObjectId(String(tenantId));
}

exports.getSummary = async (tenantId) => {
  const tid = oid(tenantId);

  const [
    billingInvoiceTotal,
    pendingInternal,
    paidInternal,
    webhookByStatus,
    settlementTotal,
    divergenceCount,
    recentSyncAudits,
  ] = await Promise.all([
    BillingInvoice.countDocuments({ tenantId: tid }),
    BillingInvoice.countDocuments({ tenantId: tid, internalStatus: { $in: ['pending', 'overdue'] } }),
    BillingInvoice.countDocuments({ tenantId: tid, internalStatus: 'paid' }),
    BillingWebhookEvent.aggregate([
      { $match: { tenantId: tid } },
      { $group: { _id: '$status', c: { $sum: 1 } } },
    ]),
    BillingSettlement.countDocuments({ tenantId: tid }),
    countInvoiceBillingDivergences(tenantId),
    BillingAuditLog.find({ tenantId: tid, eventType: 'BILLING_SYNC_MANUAL' })
      .sort({ createdAt: -1 })
      .limit(15)
      .select('createdAt status billingInvoiceId errorSummary actorLabel meta')
      .lean(),
  ]);

  const webhook = { received: 0, processed: 0, ignored: 0, failed: 0 };
  for (const row of webhookByStatus) {
    if (row._id && webhook[row._id] != null) webhook[row._id] = row.c;
  }

  const emissionFailures = await BillingAuditLog.countDocuments({
    tenantId: tid,
    eventType: 'BILLING_CHARGE_ISSUE_FAILED',
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
  });

  return {
    billingInvoiceTotal,
    pendingInternal,
    paidInternal,
    pendingSettlementHint: pendingInternal,
    webhook,
    settlementTotal,
    divergentInvoiceLinks: divergenceCount,
    emissionFailuresLast30d: emissionFailures,
    lastManualSyncAudits: recentSyncAudits,
  };
};

async function countInvoiceBillingDivergences(tenantId) {
  const tid = oid(tenantId);
  const rows = await BillingInvoice.find({ tenantId: tid })
    .select('invoiceId internalStatus')
    .lean();
  if (!rows.length) return 0;

  const invIds = [...new Set(rows.map((r) => String(r.invoiceId)).filter((id) => mongoose.Types.ObjectId.isValid(id)))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const invoices = await Invoice.find({ _id: { $in: invIds }, tenantId: tid }).select('_id status').lean();
  const map = new Map(invoices.map((i) => [String(i._id), i.status]));

  let n = 0;
  for (const b of rows) {
    const st = map.get(String(b.invoiceId));
    if (st == null) continue;
    const invPaid = st === 'paid';
    const extPaid = b.internalStatus === 'paid';
    if (invPaid !== extPaid) n += 1;
  }
  return n;
}

exports.listBillingInvoices = async (tenantId, query = {}) => {
  const tid = oid(tenantId);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const filter = { tenantId: tid };
  if (query.internalStatus) filter.internalStatus = String(query.internalStatus);
  if (query.billingAccountId && mongoose.Types.ObjectId.isValid(String(query.billingAccountId))) {
    filter.billingAccountId = new mongoose.Types.ObjectId(String(query.billingAccountId));
  }

  const items = await BillingInvoice.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
  const invIds = items.map((i) => i.invoiceId).filter(Boolean);
  const invoices = await Invoice.find({ _id: { $in: invIds }, tenantId: tid }).select('_id status amount dueDate competence').lean();
  const imap = new Map(invoices.map((i) => [String(i._id), i]));

  return items.map((b) => {
    const inv = imap.get(String(b.invoiceId));
    const divergence =
      inv && (inv.status === 'paid') !== (b.internalStatus === 'paid')
        ? { yes: true, invoiceStatus: inv.status, billingStatus: b.internalStatus }
        : { yes: false };
    return {
      billingInvoice: b,
      internalInvoice: inv || null,
      divergence,
    };
  });
};

exports.getBillingInvoiceTimeline = async (tenantId, billingInvoiceId) => {
  if (!mongoose.Types.ObjectId.isValid(String(billingInvoiceId))) {
    throw ApiError.badRequest('billingInvoiceId inválido');
  }
  const tid = oid(tenantId);
  const bid = new mongoose.Types.ObjectId(String(billingInvoiceId));
  const bInv = await BillingInvoice.findOne({ _id: bid, tenantId: tid }).lean();
  if (!bInv) throw ApiError.notFound('BillingInvoice não encontrada');

  const chargeId = String(bInv.providerChargeId || '');

  const [internalInvoice, webhooks, settlements, audits] = await Promise.all([
    Invoice.findOne({ _id: bInv.invoiceId, tenantId: tid }).lean(),
    BillingWebhookEvent.find({ tenantId: tid, billingAccountId: bInv.billingAccountId })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean()
      .then((rows) =>
        rows
          .filter((w) => {
            if (!chargeId) return true;
            const p = w.parsed && typeof w.parsed === 'object' ? w.parsed : {};
            if (String(p.chargeId || '') === chargeId) return true;
            const raw = w.raw && typeof w.raw === 'object' ? w.raw : {};
            if (String(raw.id || raw.invoice_id || '') === chargeId) return true;
            return String(w.providerEventId || '').includes(chargeId);
          })
          .slice(0, 80),
      ),
    BillingSettlement.find({ tenantId: tid, billingInvoiceId: bInv._id }).sort({ settledAt: -1 }).lean(),
    BillingAuditLog.find({ tenantId: tid, $or: [{ billingInvoiceId: bInv._id }, { invoiceId: bInv.invoiceId }] })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  return {
    billingInvoice: bInv,
    internalInvoice,
    webhooks: webhooks.map((w) => ({
      _id: w._id,
      providerEventId: w.providerEventId,
      eventType: w.eventType,
      status: w.status,
      errorMessage: w.errorMessage,
      processedAt: w.processedAt,
      createdAt: w.createdAt,
      requestFingerprint: w.requestFingerprint || null,
      sourceIp: w.sourceIp || null,
    })),
    settlements,
    audits,
  };
};
