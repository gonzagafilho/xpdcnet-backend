const crypto = require('crypto');
const BaseBillingAdapter = require('./baseBillingAdapter');

const SAFE_MODES = new Set(['mock', 'sandbox']);
const MOCK_BASE_URL = 'https://mock.xpdcnet.local/bolepix';

function getMode(ctx) {
  const accountConfig = (ctx && ctx.account && ctx.account.config) || {};
  const providerConfig = (ctx && ctx.provider && ctx.provider.config) || {};
  return String(
    accountConfig.mode ||
      accountConfig.environment ||
      providerConfig.mode ||
      providerConfig.environment ||
      'mock',
  )
    .trim()
    .toLowerCase();
}

function assertMockMode(ctx) {
  const mode = getMode(ctx);
  if (!SAFE_MODES.has(mode)) {
    const err = new Error(
      'BOLEPIX_MOCK_ONLY: provider bolepix esta disponivel apenas em modo mock/sandbox nesta versao.',
    );
    err.code = 'BOLEPIX_MOCK_ONLY';
    throw err;
  }
  return mode;
}

function stableHash(...parts) {
  return crypto.createHash('sha256').update(parts.map((p) => String(p || '')).join('|')).digest('hex');
}

function mockChargeId(ctx, payload = {}) {
  const seed = stableHash(
    'xpdcnet-bolepix-mock',
    ctx && ctx.tenantId,
    ctx && ctx.meta && ctx.meta.invoiceId,
    payload.reference,
    payload.code,
  );
  return `bolepix_mock_${seed.slice(0, 24)}`;
}

function amountToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('BOLEPIX_MOCK_CHARGE: amount invalido');
    err.code = 'BOLEPIX_MOCK_CHARGE';
    throw err;
  }
  return Math.round(amount * 100);
}

function dueDateIso(value) {
  const due = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(due.getTime())) {
    const err = new Error('BOLEPIX_MOCK_CHARGE: dueDate invalida');
    err.code = 'BOLEPIX_MOCK_CHARGE';
    throw err;
  }
  return due.toISOString().slice(0, 10);
}

function normalizeExternalStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (['paid', 'settled', 'received', 'confirmed'].includes(s)) return 'paid';
  if (['cancelled', 'canceled', 'voided'].includes(s)) return 'cancelled';
  if (['overdue', 'late'].includes(s)) return 'overdue';
  return 'pending';
}

class BolepixBillingAdapter extends BaseBillingAdapter {
  constructor() {
    super('BOLEPIX');
  }

  async createCustomer(ctx, payload = {}) {
    assertMockMode(ctx);
    const client = (ctx && ctx.client) || {};
    const clientId = client._id ? String(client._id) : 'unknown';
    return {
      mode: 'bolepix_mock',
      provider: 'BOLEPIX',
      providerCustomerId: `bolepix_mock_customer_${clientId}`,
      id: `bolepix_mock_customer_${clientId}`,
      payload: {
        name: payload.name || client.fullName || 'Cliente XPDCNET',
        email: payload.email || client.email || '',
        document: payload.document || client.document || '',
        phone: payload.phone || client.phone || '',
      },
    };
  }

  async updateCustomer(ctx, payload = {}) {
    return this.createCustomer(ctx, payload);
  }

  async createCharge(ctx, payload = {}) {
    const mode = assertMockMode(ctx);
    const meta = (ctx && ctx.meta) || {};
    const amountCents = amountToCents(payload.amount);
    const dueDate = dueDateIso(payload.dueDate);
    const id = mockChargeId(ctx, payload);
    const reference = String(payload.reference || payload.code || meta.invoiceId || id);
    const pixCopyPaste = `BOLEPIX-MOCK-PIX-${stableHash(id, reference).slice(0, 48).toUpperCase()}`;
    const boletoUrl = `${MOCK_BASE_URL}/boletos/${encodeURIComponent(id)}.pdf`;

    return {
      mode: 'bolepix_mock',
      environment: mode,
      id,
      externalId: id,
      providerChargeId: id,
      status: 'pending',
      providerStatus: 'pending',
      internalStatus: 'pending',
      amountCents,
      dueDate,
      checkoutUrl: `${MOCK_BASE_URL}/checkout/${encodeURIComponent(id)}`,
      pixCopyPaste,
      pixPayload: pixCopyPaste,
      pixQrCodeUrl: `${MOCK_BASE_URL}/pix/${encodeURIComponent(id)}.png`,
      boletoUrl,
      boletoBarcode: `23790${stableHash('boleto', id).slice(0, 39)}`,
      raw: {
        mock: true,
        provider: 'BOLEPIX',
        environment: mode,
        externalId: id,
        reference,
        status: 'pending',
        pixCopyPaste,
        boletoUrl,
        warning: 'Cobranca simulada. Nao representa boleto ou Pix real.',
      },
    };
  }

  async getCharge(ctx, chargeId) {
    const mode = assertMockMode(ctx);
    const id = String(chargeId || '').trim();
    if (!id) {
      const err = new Error('BOLEPIX_MOCK_GET: chargeId vazio');
      err.code = 'BOLEPIX_MOCK_GET';
      throw err;
    }

    const accountConfig = (ctx && ctx.account && ctx.account.config) || {};
    const status = normalizeExternalStatus(accountConfig.mockStatus || 'pending');
    const pixCopyPaste = `BOLEPIX-MOCK-PIX-${stableHash(id).slice(0, 48).toUpperCase()}`;

    return {
      mode: 'bolepix_mock',
      environment: mode,
      id,
      externalId: id,
      providerChargeId: id,
      status,
      providerStatus: status,
      checkoutUrl: `${MOCK_BASE_URL}/checkout/${encodeURIComponent(id)}`,
      pixCopyPaste,
      pixPayload: pixCopyPaste,
      boletoUrl: `${MOCK_BASE_URL}/boletos/${encodeURIComponent(id)}.pdf`,
      boletoBarcode: `23790${stableHash('boleto', id).slice(0, 39)}`,
      paidAt: status === 'paid' ? new Date().toISOString() : null,
      raw: {
        mock: true,
        provider: 'BOLEPIX',
        environment: mode,
        externalId: id,
        status,
      },
    };
  }

  async cancelCharge(ctx, chargeId) {
    const mode = assertMockMode(ctx);
    const id = String(chargeId || '').trim();
    if (!id) {
      const err = new Error('BOLEPIX_MOCK_CANCEL: chargeId vazio');
      err.code = 'BOLEPIX_MOCK_CANCEL';
      throw err;
    }

    return {
      mode: 'bolepix_mock',
      environment: mode,
      id,
      externalId: id,
      providerChargeId: id,
      status: 'cancelled',
      providerStatus: 'cancelled',
      raw: {
        mock: true,
        provider: 'BOLEPIX',
        environment: mode,
        externalId: id,
        status: 'cancelled',
      },
    };
  }

  async listCharges(ctx, query = {}) {
    const mode = assertMockMode(ctx);
    return { mode: 'bolepix_mock', environment: mode, items: [], query, mock: true };
  }

  verifyWebhookInbound(ctx) {
    assertMockMode({ account: ctx });
    return true;
  }

  parseWebhook(rawBody) {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const chargeId = body.externalId || body.providerChargeId || body.id || null;
    const eventType = body.eventType || 'bolepix.mock.event';
    return {
      providerEventId: body.providerEventId || (chargeId ? `bolepix:mock:${chargeId}:${eventType}` : `bolepix:mock:${stableHash(JSON.stringify(body))}`),
      eventType,
      chargeId,
      externalStatus: body.status || 'pending',
      payload: body,
    };
  }

  mapExternalStatusToInternalStatus(externalStatus) {
    return normalizeExternalStatus(externalStatus);
  }
}

module.exports = BolepixBillingAdapter;
