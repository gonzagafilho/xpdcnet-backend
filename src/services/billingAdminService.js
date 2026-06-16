const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const BillingProvider = require('../models/billing/BillingProvider');
const BillingAccount = require('../models/billing/BillingAccount');
const BillingInvoice = require('../models/billing/BillingInvoice');
const BillingWebhookEvent = require('../models/billing/BillingWebhookEvent');
const BillingAuditLog = require('../models/billing/BillingAuditLog');
const BillingPolicy = require('../models/billing/BillingPolicy');
const Invoice = require('../models/Invoice');
const { resolveAdapter, listAdapterKeys } = require('../billing/providerRegistry');
const billingCredentialsCrypto = require('./billing/billingCredentialsCrypto');
const billingAuditService = require('./billing/billingAuditService');

const SAFE_ADAPTER_MODES = new Set(['mock', 'sandbox']);

function oid(value, fieldName = 'id') {
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw ApiError.badRequest(`${fieldName} invalido`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

function trim(value, max = 1000) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

function tenantObjectId(tenantId) {
  return oid(tenantId, 'tenantId');
}

function dateFilter(query = {}) {
  const createdAt = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) createdAt.$gte = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) createdAt.$lte = d;
  }
  return Object.keys(createdAt).length ? createdAt : null;
}

function limitFromQuery(query = {}) {
  return Math.min(200, Math.max(1, Number(query.limit) || 50));
}

function maskAccount(doc) {
  return billingCredentialsCrypto.maskBillingAccountLean(doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
}

function providerPayload(tenantId, data = {}, existing = null) {
  const patch = {};

  if (!existing || data.code !== undefined) {
    const code = trim(data.code, 64).toUpperCase();
    if (!code) throw ApiError.badRequest('code e obrigatorio');
    patch.code = code;
  }

  if (!existing || data.name !== undefined) {
    const name = trim(data.name, 160);
    if (!name) throw ApiError.badRequest('name e obrigatorio');
    patch.name = name;
  }

  if (!existing || data.adapterKey !== undefined) {
    const adapterKey = trim(data.adapterKey, 64).toLowerCase();
    if (!adapterKey) throw ApiError.badRequest('adapterKey e obrigatorio');
    if (!listAdapterKeys().includes(adapterKey)) throw ApiError.badRequest('adapterKey nao suportado nesta versao');
    patch.adapterKey = adapterKey;
  }

  if (data.isActive !== undefined) patch.isActive = data.isActive !== false;
  if (data.config !== undefined) patch.config = data.config || null;
  if (!existing) patch.tenantId = tenantObjectId(tenantId);

  return patch;
}

function accountMode(account, provider) {
  const accConfig = (account && account.config) || {};
  const providerConfig = (provider && provider.config) || {};
  return trim(accConfig.mode || accConfig.environment || providerConfig.mode || providerConfig.environment || '', 40).toLowerCase();
}

function assertSafeCancelMode(account, provider) {
  const mode = accountMode(account, provider);
  if (!SAFE_ADAPTER_MODES.has(mode)) {
    throw ApiError.unprocessable('Cancelamento via Billing Admin permitido apenas para mock/sandbox.', 'BILLING_CANCEL_REQUIRES_MOCK_OR_SANDBOX');
  }
  return mode;
}

async function loadProvider(tenantId, id) {
  const provider = await BillingProvider.findOne({ _id: oid(id), tenantId: tenantObjectId(tenantId) }).lean();
  if (!provider) throw ApiError.notFound('BillingProvider nao encontrado');
  return provider;
}

async function loadAccount(tenantId, id, asDocument = false) {
  const query = BillingAccount.findOne({ _id: oid(id), tenantId: tenantObjectId(tenantId) });
  const account = asDocument ? await query : await query.lean();
  if (!account) throw ApiError.notFound('BillingAccount nao encontrada');
  return account;
}

async function loadBillingInvoice(tenantId, id) {
  const billingInvoice = await BillingInvoice.findOne({ _id: oid(id), tenantId: tenantObjectId(tenantId) }).lean();
  if (!billingInvoice) throw ApiError.notFound('BillingInvoice nao encontrada');
  return billingInvoice;
}


async function accountIdsForProviderFilters(tenantId, query = {}) {
  const tid = tenantObjectId(tenantId);
  const providerFilter = { tenantId: tid };
  let hasProviderFilter = false;

  if (query.providerId) {
    providerFilter._id = oid(query.providerId, 'providerId');
    hasProviderFilter = true;
  }
  if (query.providerCode) {
    providerFilter.code = trim(query.providerCode, 80).toUpperCase();
    hasProviderFilter = true;
  }
  if (query.adapterKey) {
    providerFilter.adapterKey = trim(query.adapterKey, 80).toLowerCase();
    hasProviderFilter = true;
  }

  if (!hasProviderFilter) return null;

  const providers = await BillingProvider.find(providerFilter).select('_id').lean();
  if (!providers.length) return [];
  const providerIds = providers.map((p) => p._id);
  const accounts = await BillingAccount.find({ tenantId: tid, providerId: { $in: providerIds } })
    .select('_id')
    .lean();
  return accounts.map((a) => a._id);
}

async function applyAccountProviderFilters(filter, tenantId, query = {}) {
  const accountIds = await accountIdsForProviderFilters(tenantId, query);
  if (query.billingAccountId) {
    const accountId = oid(query.billingAccountId, 'billingAccountId');
    if (accountIds && !accountIds.some((id) => String(id) === String(accountId))) {
      filter.billingAccountId = { $in: [] };
      return filter;
    }
    filter.billingAccountId = accountId;
    return filter;
  }
  if (accountIds) filter.billingAccountId = { $in: accountIds };
  return filter;
}

async function accountWithProvider(tenantId, accountId) {
  const accountDoc = await loadAccount(tenantId, accountId, true);
  const account = accountDoc.toObject();
  const provider = await loadProvider(tenantId, account.providerId);
  if (provider.isActive === false) throw ApiError.badRequest('BillingProvider inativo');
  if (account.isActive === false) throw ApiError.badRequest('BillingAccount inativa');
  const adapter = resolveAdapter(provider.adapterKey);
  if (!adapter) throw ApiError.badRequest(`Adapter nao registrado para ${provider.adapterKey}`);
  const accountForAdapter = billingCredentialsCrypto.accountForAdapter(accountDoc);
  return { account, accountDoc, accountForAdapter, provider, adapter };
}

exports.listAdapters = async () => ({ adapters: listAdapterKeys() });

exports.listProviders = async (tenantId, query = {}) => {
  const filter = { tenantId: tenantObjectId(tenantId) };
  if (query.adapterKey) filter.adapterKey = trim(query.adapterKey, 64).toLowerCase();
  if (query.isActive !== undefined) filter.isActive = String(query.isActive) !== 'false';
  const createdAt = dateFilter(query);
  if (createdAt) filter.createdAt = createdAt;
  return BillingProvider.find(filter).sort({ createdAt: -1 }).limit(limitFromQuery(query)).lean();
};

exports.createProvider = async (tenantId, data = {}) => {
  const created = await BillingProvider.create(providerPayload(tenantId, data));
  return created.toObject();
};

exports.getProvider = async (tenantId, id) => loadProvider(tenantId, id);

exports.updateProvider = async (tenantId, id, data = {}) => {
  const existing = await loadProvider(tenantId, id);
  const patch = providerPayload(tenantId, data, existing);
  const updated = await BillingProvider.findOneAndUpdate(
    { _id: existing._id, tenantId: tenantObjectId(tenantId) },
    { $set: patch },
    { new: true },
  ).lean();
  return updated;
};

exports.setProviderActive = async (tenantId, id, isActive) => {
  await loadProvider(tenantId, id);
  return BillingProvider.findOneAndUpdate(
    { _id: oid(id), tenantId: tenantObjectId(tenantId) },
    { $set: { isActive: Boolean(isActive) } },
    { new: true },
  ).lean();
};

exports.listAccounts = async (tenantId, query = {}) => {
  const filter = { tenantId: tenantObjectId(tenantId) };
  if (query.providerId) filter.providerId = oid(query.providerId, 'providerId');
  if (query.isActive !== undefined) filter.isActive = String(query.isActive) !== 'false';
  if (query.isDefault !== undefined) filter.isDefault = String(query.isDefault) === 'true';
  const createdAt = dateFilter(query);
  if (createdAt) filter.createdAt = createdAt;
  const rows = await BillingAccount.find(filter).sort({ createdAt: -1 }).limit(limitFromQuery(query)).lean();
  return rows.map(maskAccount);
};

exports.createAccount = async (tenantId, data = {}) => {
  const tid = tenantObjectId(tenantId);
  const providerId = oid(data.providerId, 'providerId');
  const provider = await BillingProvider.findOne({ _id: providerId, tenantId: tid }).lean();
  if (!provider) throw ApiError.notFound('BillingProvider nao encontrado');

  const label = trim(data.label, 160);
  if (!label) throw ApiError.badRequest('label e obrigatorio');

  let credentials = data.credentials || null;
  if (credentials && billingCredentialsCrypto.credentialsContainSecrets(credentials)) {
    credentials = billingCredentialsCrypto.encryptCredentialsForStorage(credentials);
  }

  const created = await BillingAccount.create({
    tenantId: tid,
    providerId,
    label,
    externalAccountId: trim(data.externalAccountId, 200),
    isDefault: Boolean(data.isDefault),
    isActive: data.isActive !== false,
    credentials,
    config: data.config || null,
  });

  if (created.isDefault) await exports.setDefaultAccount(tenantId, created._id);
  const fresh = await loadAccount(tenantId, created._id);
  return maskAccount(fresh);
};

exports.getAccount = async (tenantId, id) => maskAccount(await loadAccount(tenantId, id));

exports.updateAccount = async (tenantId, id, data = {}) => {
  const account = await loadAccount(tenantId, id, true);
  const patch = {};

  if (data.providerId !== undefined) {
    const providerId = oid(data.providerId, 'providerId');
    const provider = await BillingProvider.findOne({ _id: providerId, tenantId: tenantObjectId(tenantId) }).lean();
    if (!provider) throw ApiError.notFound('BillingProvider nao encontrado');
    patch.providerId = providerId;
  }
  if (data.label !== undefined) {
    const label = trim(data.label, 160);
    if (!label) throw ApiError.badRequest('label e obrigatorio');
    patch.label = label;
  }
  if (data.externalAccountId !== undefined) patch.externalAccountId = trim(data.externalAccountId, 200);
  if (data.isActive !== undefined) patch.isActive = data.isActive !== false;
  if (data.isDefault !== undefined) patch.isDefault = Boolean(data.isDefault);
  if (data.config !== undefined) patch.config = data.config || null;

  if (data.credentials !== undefined) {
    if (data.credentials === null) {
      patch.credentials = null;
    } else if (typeof data.credentials === 'object') {
      const current = account.credentials && typeof account.credentials === 'object' ? account.credentials.toObject?.() || account.credentials : {};
      const merged = { ...current, ...data.credentials };
      patch.credentials = billingCredentialsCrypto.encryptCredentialsForStorage(merged);
    } else {
      throw ApiError.badRequest('credentials deve ser objeto ou null');
    }
  }

  const updated = await BillingAccount.findOneAndUpdate(
    { _id: account._id, tenantId: tenantObjectId(tenantId) },
    { $set: patch },
    { new: true },
  ).lean();

  if (patch.isDefault === true) await exports.setDefaultAccount(tenantId, account._id);
  return maskAccount(await loadAccount(tenantId, account._id));
};

exports.setAccountActive = async (tenantId, id, isActive) => {
  await loadAccount(tenantId, id);
  const updated = await BillingAccount.findOneAndUpdate(
    { _id: oid(id), tenantId: tenantObjectId(tenantId) },
    { $set: { isActive: Boolean(isActive) } },
    { new: true },
  ).lean();
  return maskAccount(updated);
};

exports.setDefaultAccount = async (tenantId, id) => {
  const tid = tenantObjectId(tenantId);
  const account = await loadAccount(tenantId, id);
  await BillingAccount.updateMany({ tenantId: tid, _id: { $ne: account._id } }, { $set: { isDefault: false } });
  const updated = await BillingAccount.findOneAndUpdate(
    { _id: account._id, tenantId: tid },
    { $set: { isDefault: true } },
    { new: true },
  ).lean();
  await BillingPolicy.findOneAndUpdate(
    { tenantId: tid },
    { $set: { defaultBillingAccountId: updated._id, updatedAt: new Date() } },
    { upsert: true, new: true },
  ).lean();
  return maskAccount(updated);
};

function invoiceFilter(tenantId, query = {}) {
  const filter = { tenantId: tenantObjectId(tenantId) };
  if (query.billingAccountId) filter.billingAccountId = oid(query.billingAccountId, 'billingAccountId');
  if (query.providerChargeId) filter.providerChargeId = trim(query.providerChargeId, 240);
  if (query.internalStatus) filter.internalStatus = trim(query.internalStatus, 40);
  if (query.status) filter.internalStatus = trim(query.status, 40);
  const createdAt = dateFilter(query);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

exports.listBillingInvoices = async (tenantId, query = {}) => {
  const filter = await applyAccountProviderFilters(invoiceFilter(tenantId, query), tenantId, query);
  const rows = await BillingInvoice.find(filter)
    .sort({ updatedAt: -1 })
    .limit(limitFromQuery(query))
    .lean();
  return rows;
};

exports.getBillingInvoice = async (tenantId, id) => {
  const billingInvoice = await loadBillingInvoice(tenantId, id);
  const internalInvoice = await Invoice.findOne({ _id: billingInvoice.invoiceId, tenantId: tenantObjectId(tenantId) })
    .select('_id status amount dueDate competence description')
    .lean();
  return { billingInvoice, internalInvoice: internalInvoice || null };
};

exports.syncBillingInvoiceStatus = async (tenantId, id, user = null) => {
  const billingInvoice = await loadBillingInvoice(tenantId, id);
  const { account, accountForAdapter, provider, adapter } = await accountWithProvider(tenantId, billingInvoice.billingAccountId);
  if (typeof adapter.getCharge !== 'function') throw ApiError.badRequest('Adapter nao suporta consulta de status');

  const remote = await adapter.getCharge(
    { tenantId, account: accountForAdapter, provider, meta: { source: 'billing-admin-status', billingInvoiceId: String(id) } },
    billingInvoice.providerChargeId,
  );

  const providerStatus = String((remote && (remote.status || remote.providerStatus)) || billingInvoice.providerStatus || '');
  const internalStatus = adapter.mapExternalStatusToInternalStatus(providerStatus);
  const updated = await BillingInvoice.findOneAndUpdate(
    { _id: billingInvoice._id, tenantId: tenantObjectId(tenantId) },
    {
      $set: {
        providerStatus,
        internalStatus,
        checkoutUrl: remote.checkoutUrl != null ? String(remote.checkoutUrl) : billingInvoice.checkoutUrl,
        pixPayload: remote.pixPayload != null ? String(remote.pixPayload) : billingInvoice.pixPayload,
        pixQrCodeUrl: remote.pixQrCodeUrl != null ? String(remote.pixQrCodeUrl) : billingInvoice.pixQrCodeUrl,
        boletoUrl: remote.boletoUrl != null ? String(remote.boletoUrl) : billingInvoice.boletoUrl,
        boletoBarcode: remote.boletoBarcode != null ? String(remote.boletoBarcode) : billingInvoice.boletoBarcode,
        paidAt: internalStatus === 'paid' ? (remote.paidAt ? new Date(remote.paidAt) : billingInvoice.paidAt) : billingInvoice.paidAt,
        raw: remote.raw != null ? remote.raw : billingInvoice.raw,
      },
    },
    { new: true },
  ).lean();

  await billingAuditService.safeLog({
    tenantId,
    billingAccountId: account._id,
    billingInvoiceId: billingInvoice._id,
    invoiceId: billingInvoice.invoiceId,
    providerCode: provider.code,
    adapterKey: provider.adapterKey,
    eventType: 'BILLING_ADMIN_STATUS_SYNC',
    status: 'success',
    actorType: user && user.email ? 'user' : 'system',
    actorLabel: user && user.email ? String(user.email).slice(0, 320) : '',
    meta: { providerStatus, internalStatus, providerChargeId: billingInvoice.providerChargeId },
  });

  return { ok: true, billingInvoice: updated, remoteDigest: { providerStatus, internalStatus } };
};

exports.cancelBillingInvoice = async (tenantId, id, user = null) => {
  const billingInvoice = await loadBillingInvoice(tenantId, id);
  const { account, accountForAdapter, provider, adapter } = await accountWithProvider(tenantId, billingInvoice.billingAccountId);
  assertSafeCancelMode(account, provider);
  if (typeof adapter.cancelCharge !== 'function') throw ApiError.badRequest('Adapter nao suporta cancelamento');

  const remote = await adapter.cancelCharge(
    { tenantId, account: accountForAdapter, provider, meta: { source: 'billing-admin-cancel', billingInvoiceId: String(id) } },
    billingInvoice.providerChargeId,
  );
  const providerStatus = String((remote && (remote.status || remote.providerStatus)) || 'cancelled');
  const internalStatus = adapter.mapExternalStatusToInternalStatus(providerStatus);

  const updated = await BillingInvoice.findOneAndUpdate(
    { _id: billingInvoice._id, tenantId: tenantObjectId(tenantId) },
    {
      $set: {
        providerStatus,
        internalStatus,
        raw: remote && remote.raw != null ? remote.raw : billingInvoice.raw,
      },
    },
    { new: true },
  ).lean();

  await billingAuditService.safeLog({
    tenantId,
    billingAccountId: account._id,
    billingInvoiceId: billingInvoice._id,
    invoiceId: billingInvoice.invoiceId,
    providerCode: provider.code,
    adapterKey: provider.adapterKey,
    eventType: 'BILLING_ADMIN_CANCELLED',
    status: 'success',
    actorType: user && user.email ? 'user' : 'system',
    actorLabel: user && user.email ? String(user.email).slice(0, 320) : '',
    meta: { providerStatus, internalStatus, providerChargeId: billingInvoice.providerChargeId },
  });

  return { ok: true, billingInvoice: updated, remoteDigest: { providerStatus, internalStatus } };
};

function eventFilter(tenantId, query = {}) {
  const filter = { tenantId: tenantObjectId(tenantId) };
  if (query.billingAccountId) filter.billingAccountId = oid(query.billingAccountId, 'billingAccountId');
  if (query.status) filter.status = trim(query.status, 40);
  if (query.eventType) filter.eventType = trim(query.eventType, 120);
  const createdAt = dateFilter(query);
  if (createdAt) filter.createdAt = createdAt;
  return filter;
}

exports.listWebhookEvents = async (tenantId, query = {}) => {
  const filter = await applyAccountProviderFilters(eventFilter(tenantId, query), tenantId, query);
  if (query.providerEventId) filter.providerEventId = trim(query.providerEventId, 240);
  return BillingWebhookEvent.find(filter).sort({ createdAt: -1 }).limit(limitFromQuery(query)).lean();
};

exports.listAuditLogs = async (tenantId, query = {}) => {
  const filter = await applyAccountProviderFilters(eventFilter(tenantId, query), tenantId, query);
  if (query.providerCode) filter.providerCode = trim(query.providerCode, 80).toUpperCase();
  if (query.adapterKey) filter.adapterKey = trim(query.adapterKey, 80).toLowerCase();
  if (query.billingInvoiceId) filter.billingInvoiceId = oid(query.billingInvoiceId, 'billingInvoiceId');
  if (query.invoiceId) filter.invoiceId = oid(query.invoiceId, 'invoiceId');
  return BillingAuditLog.find(filter).sort({ createdAt: -1 }).limit(limitFromQuery(query)).lean();
};
