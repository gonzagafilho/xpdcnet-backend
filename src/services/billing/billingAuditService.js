const BillingAuditLog = require('../../models/billing/BillingAuditLog');

function trimMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const o = { ...meta };
  if (o.errorMessage != null) o.errorMessage = String(o.errorMessage).slice(0, 500);
  return o;
}

/**
 * Nunca interromper fluxo financeiro por falha de auditoria.
 */
async function safeLog(entry) {
  try {
    const doc = {
      tenantId: entry.tenantId,
      billingAccountId: entry.billingAccountId || null,
      billingInvoiceId: entry.billingInvoiceId || null,
      invoiceId: entry.invoiceId || null,
      providerCode: entry.providerCode != null ? String(entry.providerCode).slice(0, 64) : '',
      adapterKey: entry.adapterKey != null ? String(entry.adapterKey).slice(0, 64) : '',
      eventType: String(entry.eventType || 'BILLING_EVENT').slice(0, 80),
      status: entry.status,
      errorSummary: entry.errorSummary != null ? String(entry.errorSummary).slice(0, 2000) : '',
      actorType: entry.actorType || 'system',
      actorLabel: entry.actorLabel != null ? String(entry.actorLabel).slice(0, 320) : '',
      meta: trimMeta(entry.meta),
    };
    await BillingAuditLog.create(doc);
  } catch (err) {
    console.error('[billing-audit]', err && err.message ? err.message : err);
  }
}

module.exports = {
  safeLog,
};
