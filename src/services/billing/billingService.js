const mongoose = require('mongoose');
const crypto = require('crypto');
const ApiError = require('../../errors/ApiError');
const Invoice = require('../../models/Invoice');
const Client = require('../../models/Client');
const BillingProvider = require('../../models/billing/BillingProvider');
const BillingAccount = require('../../models/billing/BillingAccount');
const BillingCustomer = require('../../models/billing/BillingCustomer');
const BillingInvoice = require('../../models/billing/BillingInvoice');
const BillingWebhookEvent = require('../../models/billing/BillingWebhookEvent');
const BillingSettlement = require('../../models/billing/BillingSettlement');
const BillingPolicy = require('../../models/billing/BillingPolicy');
const { resolveAdapter, listAdapterKeys } = require('../../billing/providerRegistry');
const billingCredentialsCrypto = require('./billingCredentialsCrypto');
const billingAuditService = require('./billingAuditService');

function headerGet(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) return String(headers[k] != null ? headers[k] : '').trim();
  }
  return '';
}

function webhookRequestFingerprint(headers, payload) {
  const pick = ['webhook-event-id', 'webhook-event-type', 'webhook-resource-id', 'user-agent'];
  const h = headers || {};
  const norm = pick.map((n) => `${n}=${headerGet(h, n)}`).join('|');
  const bodyStr = payload && typeof payload === 'object' ? JSON.stringify(payload) : String(payload || '');
  return crypto.createHash('sha256').update(`${norm}|len=${Buffer.byteLength(bodyStr, 'utf8')}`).digest('hex');
}

exports.computeWebhookRequestFingerprint = webhookRequestFingerprint;

function oid(v, f) {
  if (!mongoose.Types.ObjectId.isValid(String(v))) throw ApiError.badRequest(`${f} inválido`);
  return new mongoose.Types.ObjectId(String(v));
}

async function accountCtx(tenantId, accountId) {
  const acc = await BillingAccount.findOne({ _id: accountId, tenantId }).lean();
  if (!acc) throw ApiError.notFound('BillingAccount não encontrada');
  const provider = await BillingProvider.findOne({ _id: acc.providerId, tenantId }).lean();
  if (!provider || !provider.isActive) throw ApiError.badRequest('BillingProvider não encontrado/ativo');
  const adapter = resolveAdapter(provider.adapterKey);
  if (!adapter) throw ApiError.badRequest(`Adapter não registado para ${provider.adapterKey}`);
  return { acc, provider, adapter };
}

async function loadFullAccount(tenantId, accountId) {
  const acc = await BillingAccount.findOne({ _id: accountId, tenantId });
  if (!acc) throw ApiError.notFound('BillingAccount não encontrada');
  return acc;
}

exports.listAvailableAdapters = () => listAdapterKeys();
exports.listProviders = async (tenantId) => BillingProvider.find({ tenantId }).sort({ createdAt: -1 }).lean();
exports.listAccounts = async (tenantId) => {
  const rows = await BillingAccount.find({ tenantId }).sort({ createdAt: -1 }).lean();
  return rows.map((r) => billingCredentialsCrypto.maskBillingAccountLean(r));
};

exports.createProvider = async (tenantId, data = {}) => {
  const code = String(data.code || '').trim().toUpperCase();
  const name = String(data.name || '').trim();
  const adapterKey = String(data.adapterKey || '').trim().toLowerCase();
  if (!code || !name || !adapterKey) throw ApiError.badRequest('code, name e adapterKey são obrigatórios');
  if (!listAdapterKeys().includes(adapterKey)) throw ApiError.badRequest('adapterKey não suportado nesta versão');
  return BillingProvider.create({
    tenantId,
    code,
    name,
    adapterKey,
    isActive: data.isActive !== false,
    config: data.config || null,
  });
};

exports.createAccount = async (tenantId, data = {}) => {
  const providerId = oid(data.providerId, 'providerId');
  const p = await BillingProvider.findOne({ _id: providerId, tenantId }).lean();
  if (!p) throw ApiError.notFound('BillingProvider não encontrado');
  const label = String(data.label || '').trim();
  if (!label) throw ApiError.badRequest('label é obrigatório');
  const credIn = data.credentials || null;
  let credStore = credIn;
  if (credIn && billingCredentialsCrypto.credentialsContainSecrets(credIn)) {
    credStore = billingCredentialsCrypto.encryptCredentialsForStorage(credIn);
  }
  const created = await BillingAccount.create({
    tenantId,
    providerId,
    label,
    externalAccountId: data.externalAccountId || '',
    isDefault: Boolean(data.isDefault),
    isActive: data.isActive !== false,
    credentials: credStore,
    config: data.config || null,
  });
  const o = created.toObject ? created.toObject() : created;
  return billingCredentialsCrypto.maskBillingAccountLean(o);
};

exports.getPolicy = async (tenantId) => {
  const doc = await BillingPolicy.findOne({ tenantId }).lean();
  return (
    doc || {
      tenantId: String(tenantId),
      billingEnabled: false,
      autoIssueOnGenerateMonth: false,
      autoSyncInvoiceStatus: true,
      defaultBillingAccountId: null,
      webhookSecretHint: '',
      updatedBy: '',
      updatedAt: null,
    }
  );
};

exports.updatePolicy = async (tenantId, patch = {}, user = null) => {
  const $set = {
    billingEnabled: patch.billingEnabled === undefined ? false : Boolean(patch.billingEnabled),
    autoIssueOnGenerateMonth:
      patch.autoIssueOnGenerateMonth === undefined ? false : Boolean(patch.autoIssueOnGenerateMonth),
    autoSyncInvoiceStatus:
      patch.autoSyncInvoiceStatus === undefined ? true : Boolean(patch.autoSyncInvoiceStatus),
    webhookSecretHint: patch.webhookSecretHint ? String(patch.webhookSecretHint).slice(0, 200) : '',
    updatedBy: user && user.email ? String(user.email) : '',
    updatedAt: new Date(),
  };
  if (patch.defaultBillingAccountId !== undefined) {
    $set.defaultBillingAccountId = patch.defaultBillingAccountId ? oid(patch.defaultBillingAccountId, 'defaultBillingAccountId') : null;
  }
  return BillingPolicy.findOneAndUpdate({ tenantId }, { $set }, { new: true, upsert: true }).lean();
};

/**
 * Emissão de cobrança externa + vínculo BillingInvoice (adapter encapsula Cora).
 */
exports.issueChargeFromInvoice = async (tenantId, invoiceId, opts = {}) => {
  const inv = await Invoice.findOne({ _id: invoiceId, tenantId }).lean();
  if (!inv) throw ApiError.notFound('Invoice não encontrada');
  if (inv.status === 'paid') throw ApiError.conflict('Invoice já está paga — não emitir nova cobrança.', 'INVOICE_ALREADY_PAID');
  if (inv.status === 'cancelled') throw ApiError.conflict('Invoice cancelada.', 'INVOICE_CANCELLED');

  const client = await Client.findOne({ _id: inv.clientId, tenantId }).lean();
  if (!client) throw ApiError.notFound('Cliente da invoice não encontrado');

  let accountId = opts.billingAccountId || null;
  if (!accountId) {
    const policy = await BillingPolicy.findOne({ tenantId }).lean();
    if (policy && policy.defaultBillingAccountId) accountId = String(policy.defaultBillingAccountId);
  }
  if (!accountId) throw ApiError.badRequest('billingAccountId ausente e política sem defaultBillingAccountId');

  const { acc, provider, adapter } = await accountCtx(tenantId, accountId);
  const accDoc = await loadFullAccount(tenantId, accountId);
  const accAdapter = billingCredentialsCrypto.accountForAdapter(accDoc);
  const actorLabel = opts.userEmail != null ? String(opts.userEmail).slice(0, 320) : '';

  try {
    let bc = await BillingCustomer.findOne({ tenantId, billingAccountId: acc._id, clientId: client._id }).lean();
    if (!bc) {
      const cRes = await adapter.createCustomer(
        {
          tenantId,
          account: accAdapter,
          provider,
          client,
          meta: { source: 'issueChargeFromInvoice' },
        },
        { name: client.fullName, email: client.email || '', document: client.document || '', phone: client.phone || '' },
      );
      const providerCustomerId = String((cRes && (cRes.providerCustomerId || cRes.id)) || `xpdcnet:${client._id}`);
      bc = (
        await BillingCustomer.create({
          tenantId,
          billingAccountId: acc._id,
          clientId: client._id,
          providerCustomerId,
          payloadSnapshot: cRes || null,
        })
      ).toObject();
    }

    const ch = await adapter.createCharge(
      {
        tenantId,
        account: accAdapter,
        provider,
        client,
        meta: { source: 'invoice', invoiceId: String(inv._id) },
      },
      {
        customerId: bc.providerCustomerId,
        amount: inv.amount,
        dueDate: inv.dueDate,
        description: inv.description || `Invoice ${inv.competence}`,
        reference: String(inv._id),
        code: String(inv._id),
      },
    );

    const providerChargeId = String((ch && (ch.id || ch.providerChargeId)) || '').trim();
    if (!providerChargeId) throw ApiError.serviceUnavailable('Provider não devolveu id de cobrança', 'BILLING_NO_CHARGE_ID');

    const providerStatus = String((ch && (ch.status || ch.providerStatus)) || 'OPEN');
    const internalStatus = adapter.mapExternalStatusToInternalStatus(providerStatus);

    const doc = await BillingInvoice.findOneAndUpdate(
      { tenantId, billingAccountId: acc._id, providerChargeId },
      {
        $set: {
          billingCustomerId: bc._id,
          invoiceId: inv._id,
          providerStatus,
          internalStatus,
          dueDate: inv.dueDate,
          amount: inv.amount,
          checkoutUrl: ch.checkoutUrl != null ? String(ch.checkoutUrl) : '',
          pixPayload: ch.pixPayload != null ? String(ch.pixPayload) : '',
          pixQrCodeUrl: ch.pixQrCodeUrl != null ? String(ch.pixQrCodeUrl) : '',
          boletoUrl: ch.boletoUrl != null ? String(ch.boletoUrl) : '',
          boletoBarcode: ch.boletoBarcode != null ? String(ch.boletoBarcode) : '',
          paidAt: internalStatus === 'paid' ? new Date() : null,
          raw: ch.raw != null ? ch.raw : ch,
        },
        $setOnInsert: { tenantId, billingAccountId: acc._id, providerChargeId },
      },
      { upsert: true, new: true },
    ).lean();

    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      billingInvoiceId: doc._id,
      invoiceId: inv._id,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_CHARGE_ISSUED',
      status: 'success',
      actorType: actorLabel ? 'user' : 'system',
      actorLabel,
      meta: { providerChargeId },
    });

    return {
      billingInvoice: doc,
      provider: provider.code,
      accountId: String(acc._id),
      adapterKey: provider.adapterKey,
    };
  } catch (err) {
    const msg = err && err.message ? String(err.message).slice(0, 2000) : 'erro';
    const code = err && err.code ? String(err.code) : '';
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      invoiceId: inv._id,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_CHARGE_ISSUE_FAILED',
      status: 'failed',
      errorSummary: msg,
      actorType: actorLabel ? 'user' : 'system',
      actorLabel,
      meta: { code },
    });
    if (code === 'CORA_TOKEN' || code === 'CORA_CONFIG') {
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        invoiceId: inv._id,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_PROVIDER_AUTH_FAILED',
        status: 'failed',
        errorSummary: msg,
        actorType: actorLabel ? 'user' : 'system',
        actorLabel,
        meta: { code },
      });
    }
    throw err;
  }
};

/**
 * Webhook público: tenant resolvido pela BillingAccount (multi-tenant seguro).
 * @param {object} [meta]
 * @param {string} [meta.requestFingerprint]
 * @param {string} [meta.sourceIp]
 */
exports.receiveWebhook = async (tenantId, billingAccountId, payload, headers = {}, meta = {}) => {
  const fingerprint = meta.requestFingerprint || webhookRequestFingerprint(headers, payload);
  const sourceIp = meta.sourceIp != null ? String(meta.sourceIp).slice(0, 128) : '';

  if (payload != null && typeof payload !== 'object') {
    throw ApiError.badRequest('Payload webhook inválido');
  }

  const { acc, provider, adapter } = await accountCtx(tenantId, billingAccountId);
  const accDoc = await loadFullAccount(tenantId, billingAccountId);
  const accAdapter = billingCredentialsCrypto.accountForAdapter(accDoc);

  if (typeof adapter.verifyWebhookInbound === 'function') {
    try {
      adapter.verifyWebhookInbound(accAdapter, headers);
    } catch (err) {
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_WEBHOOK_REJECTED',
        status: 'failed',
        errorSummary: err && err.message ? String(err.message).slice(0, 2000) : 'WEBHOOK_AUTH',
        actorType: 'webhook',
        actorLabel: sourceIp || 'webhook',
        meta: { code: err && err.code, fingerprint },
      });
      const e = ApiError.unauthorized(err.message || 'Webhook não autorizado');
      e.code = err.code || 'WEBHOOK_AUTH';
      throw e;
    }
  }

  const parsed = adapter.parseWebhook(payload, headers);
  const providerEventId = String(parsed.providerEventId || '').trim();
  if (!providerEventId) throw ApiError.badRequest('Evento sem identificador idempotente');

  const existing = await BillingWebhookEvent.findOne({
    tenantId,
    billingAccountId: acc._id,
    providerEventId,
  }).lean();
  if (existing && existing.status === 'processed') {
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_WEBHOOK_DUPLICATE',
      status: 'noop',
      actorType: 'webhook',
      actorLabel: sourceIp || 'webhook',
      meta: { providerEventId, fingerprint },
    });
    return { ok: true, duplicate: true, noop: true };
  }

  let ev = existing;
  if (!ev) {
    ev = (
      await BillingWebhookEvent.create({
        tenantId,
        billingAccountId: acc._id,
        providerEventId,
        eventType: parsed.eventType || '',
        raw: payload || null,
        parsed,
        status: 'received',
        requestFingerprint: fingerprint,
        sourceIp,
      })
    ).toObject();
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_WEBHOOK_RECEIVED',
      status: 'success',
      actorType: 'webhook',
      actorLabel: sourceIp || 'webhook',
      meta: { providerEventId, fingerprint },
    });
  } else {
    await BillingWebhookEvent.updateOne(
      { _id: ev._id },
      {
        $set: {
          raw: payload || null,
          parsed,
          status: 'received',
          errorMessage: '',
          requestFingerprint: fingerprint,
          sourceIp,
        },
      },
    );
  }

  try {
    const chargeId = parsed.chargeId ? String(parsed.chargeId) : '';
    if (!chargeId) {
      await BillingWebhookEvent.updateOne({ _id: ev._id }, { $set: { status: 'ignored', processedAt: new Date() } });
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_WEBHOOK_IGNORED',
        status: 'ignored',
        actorType: 'webhook',
        actorLabel: sourceIp || 'webhook',
        meta: { reason: 'no_charge_id', providerEventId, fingerprint },
      });
      return { ok: true, ignored: true, reason: 'no_charge_id' };
    }

    const bInv = await BillingInvoice.findOne({
      tenantId,
      billingAccountId: acc._id,
      providerChargeId: chargeId,
    }).lean();
    if (!bInv) {
      await BillingWebhookEvent.updateOne({ _id: ev._id }, { $set: { status: 'ignored', processedAt: new Date() } });
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_WEBHOOK_IGNORED',
        status: 'ignored',
        actorType: 'webhook',
        actorLabel: sourceIp || 'webhook',
        meta: { reason: 'billing_invoice_not_found', chargeId, providerEventId, fingerprint },
      });
      return { ok: true, ignored: true, reason: 'billing_invoice_not_found' };
    }

    const ext = parsed.externalStatus != null ? String(parsed.externalStatus) : '';
    const internalFromEvent = adapter.mapExternalStatusToInternalStatus(ext);
    let internalStatus = internalFromEvent;
    let providerStatus = ext || bInv.providerStatus;

    if (!ext && (parsed.eventType || '').toLowerCase().includes('paid')) {
      internalStatus = 'paid';
      providerStatus = providerStatus || 'PAID';
    }

    if (bInv.internalStatus === 'paid' && internalStatus !== 'paid') {
      await BillingWebhookEvent.updateOne({ _id: ev._id }, { $set: { status: 'ignored', processedAt: new Date() } });
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        billingInvoiceId: bInv._id,
        invoiceId: bInv.invoiceId,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_WEBHOOK_IGNORED',
        status: 'ignored',
        actorType: 'webhook',
        actorLabel: sourceIp || 'webhook',
        meta: { reason: 'would_downgrade_paid', chargeId, providerEventId, fingerprint },
      });
      return { ok: true, ignored: true, reason: 'would_downgrade_paid' };
    }

    const paidAt = internalStatus === 'paid' ? new Date() : null;

    const updatedBilling = await BillingInvoice.findOneAndUpdate(
      { _id: bInv._id, tenantId },
      {
        $set: {
          providerStatus,
          internalStatus,
          paidAt: internalStatus === 'paid' ? paidAt : bInv.paidAt,
          raw: parsed.payload && Object.keys(parsed.payload).length ? parsed.payload : bInv.raw,
        },
      },
      { new: true },
    ).lean();

    let settlementCreated = false;
    if (internalStatus === 'paid' && updatedBilling && updatedBilling.invoiceId) {
      const inv = await Invoice.findOne({ _id: updatedBilling.invoiceId, tenantId }).lean();
      if (inv && inv.status !== 'paid') {
        await Invoice.updateOne(
          { _id: updatedBilling.invoiceId, tenantId, status: { $ne: 'paid' } },
          { $set: { status: 'paid', paidAt: paidAt || new Date() } },
        );
      }

      const settlementKey = `webhook:${providerEventId}`;
      const hasSet = await BillingSettlement.findOne({
        tenantId,
        billingAccountId: acc._id,
        providerSettlementId: settlementKey,
      }).lean();
      if (!hasSet) {
        await BillingSettlement.create({
          tenantId,
          billingAccountId: acc._id,
          billingInvoiceId: updatedBilling._id,
          invoiceId: updatedBilling.invoiceId,
          providerSettlementId: settlementKey,
          amount: Number(updatedBilling.amount) || 0,
          feeAmount: 0,
          netAmount: Number(updatedBilling.amount) || 0,
          settledAt: paidAt || new Date(),
          raw: { eventType: parsed.eventType, chargeId, providerEventId },
        });
        settlementCreated = true;
      }
    }

    await BillingWebhookEvent.updateOne(
      { _id: ev._id },
      { $set: { status: 'processed', processedAt: new Date(), errorMessage: '' } },
    );

    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      billingInvoiceId: bInv._id,
      invoiceId: bInv.invoiceId,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_WEBHOOK_PROCESSED',
      status: 'success',
      actorType: 'webhook',
      actorLabel: sourceIp || 'webhook',
      meta: { chargeId, providerEventId, fingerprint, settlementCreated },
    });

    if (settlementCreated) {
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        billingInvoiceId: bInv._id,
        invoiceId: bInv.invoiceId,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_SETTLEMENT_APPLIED',
        status: 'success',
        actorType: 'webhook',
        actorLabel: sourceIp || 'webhook',
        meta: { providerEventId, chargeId, source: 'webhook' },
      });
    }

    return { ok: true, duplicate: false, billingInvoiceId: String(bInv._id) };
  } catch (err) {
    await BillingWebhookEvent.updateOne(
      { _id: ev._id },
      {
        $set: {
          status: 'failed',
          errorMessage: err && err.message ? String(err.message).slice(0, 2000) : 'erro',
          processedAt: new Date(),
        },
      },
    );
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_WEBHOOK_FAILED',
      status: 'failed',
      errorSummary: err && err.message ? String(err.message).slice(0, 2000) : 'erro',
      actorType: 'webhook',
      actorLabel: sourceIp || 'webhook',
      meta: { fingerprint },
    });
    throw err;
  }
};

/**
 * Reconsulta charge no provider e aplica atualização conservadora no BillingInvoice + Invoice.
 */
exports.syncBillingInvoiceFromProvider = async (tenantId, billingInvoiceId, user = null) => {
  if (!mongoose.Types.ObjectId.isValid(String(billingInvoiceId))) throw ApiError.badRequest('billingInvoiceId inválido');
  const bInv = await BillingInvoice.findOne({ _id: billingInvoiceId, tenantId }).lean();
  if (!bInv) throw ApiError.notFound('BillingInvoice não encontrada');

  const { adapter, acc, provider } = await accountCtx(tenantId, bInv.billingAccountId);
  if (typeof adapter.getCharge !== 'function') {
    throw ApiError.badRequest('Adapter não suporta getCharge');
  }

  const accDoc = await loadFullAccount(tenantId, bInv.billingAccountId);
  const accAdapter = billingCredentialsCrypto.accountForAdapter(accDoc);
  const actorLabel =
    user && typeof user === 'object' && user.email != null ? String(user.email).slice(0, 320) : '';

  let remote;
  try {
    remote = await adapter.getCharge(
      { tenantId, account: accAdapter, provider, meta: { source: 'syncBillingInvoiceFromProvider' } },
      bInv.providerChargeId,
    );
  } catch (err) {
    const msg = err && err.message ? String(err.message).slice(0, 2000) : 'erro';
    const code = err && err.code ? String(err.code) : '';
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      billingInvoiceId: bInv._id,
      invoiceId: bInv.invoiceId,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_SYNC_FAILED',
      status: 'failed',
      errorSummary: msg,
      actorType: actorLabel ? 'user' : 'system',
      actorLabel,
      meta: { code, providerChargeId: bInv.providerChargeId },
    });
    if (code === 'CORA_TOKEN' || code === 'CORA_CONFIG') {
      await billingAuditService.safeLog({
        tenantId: accDoc.tenantId,
        billingAccountId: acc._id,
        billingInvoiceId: bInv._id,
        invoiceId: bInv.invoiceId,
        providerCode: provider.code,
        adapterKey: provider.adapterKey,
        eventType: 'BILLING_PROVIDER_AUTH_FAILED',
        status: 'failed',
        errorSummary: msg,
        actorType: actorLabel ? 'user' : 'system',
        actorLabel,
        meta: { code },
      });
    }
    throw err;
  }

  const providerStatus = String((remote && (remote.status || remote.providerStatus)) || '');
  const internalNext = adapter.mapExternalStatusToInternalStatus(providerStatus);

  if (bInv.internalStatus === 'paid' && internalNext !== 'paid') {
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      billingInvoiceId: bInv._id,
      invoiceId: bInv.invoiceId,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_SYNC_MANUAL',
      status: 'noop',
      actorType: actorLabel ? 'user' : 'system',
      actorLabel,
      meta: { reason: 'billing_already_paid_no_downgrade' },
    });
    return {
      ok: true,
      noop: true,
      reason: 'billing_already_paid_no_downgrade',
      billingInvoice: bInv,
      remote,
    };
  }

  const paidAt =
    internalNext === 'paid'
      ? remote.paidAt
        ? new Date(remote.paidAt)
        : remote.raw && remote.raw.paid_at
          ? new Date(remote.raw.paid_at)
          : remote.raw && remote.raw.occurrence_date
            ? new Date(remote.raw.occurrence_date)
            : new Date()
      : null;

  const updated = await BillingInvoice.findOneAndUpdate(
    { _id: bInv._id, tenantId },
    {
      $set: {
        providerStatus,
        internalStatus: internalNext,
        paidAt: internalNext === 'paid' ? paidAt : bInv.paidAt,
        checkoutUrl: remote.checkoutUrl != null ? String(remote.checkoutUrl) : bInv.checkoutUrl,
        pixPayload: remote.pixPayload != null ? String(remote.pixPayload) : bInv.pixPayload,
        boletoUrl: remote.boletoUrl != null ? String(remote.boletoUrl) : bInv.boletoUrl,
        boletoBarcode: remote.boletoBarcode != null ? String(remote.boletoBarcode) : bInv.boletoBarcode,
        raw: remote.raw != null ? remote.raw : bInv.raw,
      },
    },
    { new: true },
  ).lean();

  let settlementCreated = false;
  if (internalNext === 'paid' && updated && updated.invoiceId) {
    await Invoice.updateOne(
      { _id: updated.invoiceId, tenantId, status: { $ne: 'paid' } },
      { $set: { status: 'paid', paidAt: paidAt || new Date() } },
    );
    const settlementKey = `sync:${String(updated.invoiceId)}:${String(updated.providerChargeId)}:PAID`;
    const hasSet = await BillingSettlement.findOne({
      tenantId,
      billingAccountId: acc._id,
      providerSettlementId: settlementKey,
    }).lean();
    if (!hasSet) {
      await BillingSettlement.create({
        tenantId,
        billingAccountId: acc._id,
        billingInvoiceId: updated._id,
        invoiceId: updated.invoiceId,
        providerSettlementId: settlementKey,
        amount: Number(updated.amount) || 0,
        feeAmount: 0,
        netAmount: Number(updated.amount) || 0,
        settledAt: paidAt || new Date(),
        raw: { source: 'syncBillingInvoiceFromProvider', remote: remote.raw || null },
      });
      settlementCreated = true;
    }
  }

  await billingAuditService.safeLog({
    tenantId: accDoc.tenantId,
    billingAccountId: acc._id,
    billingInvoiceId: bInv._id,
    invoiceId: bInv.invoiceId,
    providerCode: provider.code,
    adapterKey: provider.adapterKey,
    eventType: 'BILLING_SYNC_MANUAL',
    status: 'success',
    actorType: actorLabel ? 'user' : 'system',
    actorLabel,
    meta: {
      providerChargeId: bInv.providerChargeId,
      providerStatus,
      internalNext,
      settlementCreated,
    },
  });

  if (settlementCreated) {
    await billingAuditService.safeLog({
      tenantId: accDoc.tenantId,
      billingAccountId: acc._id,
      billingInvoiceId: updated._id,
      invoiceId: updated.invoiceId,
      providerCode: provider.code,
      adapterKey: provider.adapterKey,
      eventType: 'BILLING_SETTLEMENT_APPLIED',
      status: 'success',
      actorType: actorLabel ? 'user' : 'system',
      actorLabel,
      meta: { source: 'sync' },
    });
  }

  return { ok: true, billingInvoice: updated, remoteDigest: { status: providerStatus, internalStatus: internalNext } };
};
