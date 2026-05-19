const crypto = require('crypto');
const BaseBillingAdapter = require('./baseBillingAdapter');
const { coraApiJson, resolveCoraAccountConfig } = require('../coraApiClient');

/**
 * Cora — emissão/consulta de faturas (boleto + Pix conforme payment_forms).
 * Webhooks: cabeçalhos documentados (sem corpo na amostra oficial).
 * @see https://developers.cora.com.br/reference/emiss%C3%A3o-de-boleto-registrado
 * @see https://developers.cora.com.br/reference/exemplo-de-post-da-notifica%C3%A7%C3%A3o
 */

function headerGet(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) return String(headers[k] != null ? headers[k] : '').trim();
  }
  return '';
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function inferDocumentType(identityDigits) {
  if (identityDigits.length === 11) return 'CPF';
  return 'CNPJ';
}

/** UUID v4 formato estável por (tenant, invoice) — idempotência em reemissões da mesma fatura. */
function idempotencyKeyForInvoice(tenantId, invoiceId) {
  const h = crypto.createHash('sha256').update(`xpdcnet-cora:${tenantId}:${invoiceId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-8${h.slice(15, 18)}-${h.slice(20, 32)}`;
}

function buildCustomer(ctx, payload) {
  const client = ctx.client;
  const accCfg = (ctx.account && ctx.account.config) || {};
  const defaults = accCfg.defaultCustomerAddress || {};
  const docRaw = onlyDigits(payload.document != null ? payload.document : client && client.document);
  const identity =
    docRaw ||
    onlyDigits(accCfg.fallbackDocument) ||
    '00000000000191'; // placeholder CNPJ — operador deve configurar cliente/documento real
  const type = inferDocumentType(identity);

  const addr = (client && client.address) || {};
  return {
    name: String((payload.name != null ? payload.name : client && client.fullName) || 'Cliente').slice(0, 200),
    email: String((payload.email != null ? payload.email : client && client.email) || 'nao-informado@xpdcnet.local').slice(0, 200),
    telephone: onlyDigits(payload.phone != null ? payload.phone : client && client.phone) || null,
    document: { identity, type },
    address: {
      street: String(addr.street || defaults.street || 'N/A').slice(0, 120),
      number: String(addr.number || defaults.number || 'S/N').slice(0, 20),
      district: String(addr.neighborhood || defaults.district || defaults.neighborhood || 'N/A').slice(0, 80),
      city: String(addr.city || defaults.city || 'São Paulo').slice(0, 80),
      state: String(addr.state || defaults.state || 'SP').slice(0, 2).toUpperCase(),
      complement: String(addr.reference || defaults.complement || 'N/A').slice(0, 80),
      zip_code: onlyDigits(addr.zip || defaults.zip_code) || '01310100',
    },
  };
}

class CoraBillingAdapter extends BaseBillingAdapter {
  constructor() {
    super('CORA');
  }

  /**
   * Cora emite fatura com customer inline — não exige cadastro prévio de cliente na API.
   * Persistimos um id interno estável para BillingCustomer.
   */
  async createCustomer(ctx, payload) {
    const cid = ctx.client && ctx.client._id ? String(ctx.client._id) : 'unknown';
    return {
      mode: 'cora_inline',
      provider: 'CORA',
      providerCustomerId: `xpdcnet:${cid}`,
      id: `xpdcnet:${cid}`,
      payload: payload || {},
    };
  }

  async updateCustomer(ctx, payload) {
    return this.createCustomer(ctx, payload);
  }

  async createCharge(ctx, payload) {
    resolveCoraAccountConfig(ctx.account);
    const accCfg = (ctx.account && ctx.account.config) || {};
    const amountReais = Number(payload.amount);
    if (!Number.isFinite(amountReais) || amountReais <= 0) {
      const e = new Error('CORA_CHARGE: amount inválido');
      e.code = 'CORA_CHARGE';
      throw e;
    }
    const amountCents = Math.round(amountReais * 100);
    const due = payload.dueDate instanceof Date ? payload.dueDate : new Date(payload.dueDate);
    if (Number.isNaN(due.getTime())) {
      const e = new Error('CORA_CHARGE: dueDate inválida');
      e.code = 'CORA_CHARGE';
      throw e;
    }
    const dueStr = due.toISOString().slice(0, 10);
    const customer = buildCustomer(ctx, {
      name: payload.customerName,
      email: payload.customerEmail,
      document: payload.customerDocument,
      phone: payload.customerPhone,
    });

    const paymentForms = Array.isArray(accCfg.paymentForms) && accCfg.paymentForms.length
      ? accCfg.paymentForms
      : ['BANK_SLIP', 'PIX'];

    const code = String(payload.reference || payload.code || ctx.meta?.invoiceId || '').slice(0, 120);

    const body = {
      code: code || undefined,
      customer,
      services: [
        {
          name: String(payload.serviceName || 'Cobrança').slice(0, 120),
          description: String(payload.description || 'Fatura').slice(0, 500),
          amount: amountCents,
        },
      ],
      payment_terms: {
        due_date: dueStr,
      },
      payment_forms: paymentForms,
    };

    const idemKey =
      (payload.idempotencyKey && String(payload.idempotencyKey)) ||
      idempotencyKeyForInvoice(String(ctx.tenantId), String(ctx.meta?.invoiceId || code || ''));

    const created = await coraApiJson(ctx.account, {
      method: 'POST',
      path: '/v2/invoices',
      jsonBody: body,
      idempotencyKey: idemKey,
    });

    const id = created && created.id != null ? String(created.id) : '';
    if (!id) {
      const e = new Error('CORA_CHARGE: resposta sem id');
      e.code = 'CORA_CHARGE';
      throw e;
    }

    const status = created && created.status != null ? String(created.status) : 'OPEN';
    const pixEmv = created && created.pix && created.pix.emv ? String(created.pix.emv) : '';
    const slip = created && created.payment_options && created.payment_options.bank_slip ? created.payment_options.bank_slip : null;

    return {
      mode: 'cora_api',
      id,
      providerChargeId: id,
      status,
      providerStatus: status,
      totalAmountCents: created.total_amount,
      totalPaidCents: created.total_paid,
      checkoutUrl: slip && slip.url ? String(slip.url) : '',
      pixPayload: pixEmv,
      pixQrCodeUrl: '',
      boletoUrl: slip && slip.url ? String(slip.url) : '',
      boletoBarcode: slip && slip.digitable ? String(slip.digitable) : slip && slip.barcode ? String(slip.barcode) : '',
      raw: created,
      idempotencyKey: idemKey,
    };
  }

  async getCharge(ctx, chargeId) {
    resolveCoraAccountConfig(ctx.account);
    const id = String(chargeId || '').trim();
    if (!id) {
      const e = new Error('CORA_GET: chargeId vazio');
      e.code = 'CORA_GET';
      throw e;
    }
    const data = await coraApiJson(ctx.account, { method: 'GET', path: `/v2/invoices/${encodeURIComponent(id)}` });
    const status = data && data.status != null ? String(data.status) : '';
    const pixEmv = data && data.pix && data.pix.emv ? String(data.pix.emv) : '';
    const slip = data && data.payment_options && data.payment_options.bank_slip ? data.payment_options.bank_slip : null;
    let paidAtFromPayments = null;
    if (data && Array.isArray(data.payments) && data.payments.length) {
      const last = data.payments[data.payments.length - 1];
      if (last && last.finalized_at) paidAtFromPayments = last.finalized_at;
    }
    return {
      mode: 'cora_api',
      id: data && data.id != null ? String(data.id) : id,
      providerChargeId: data && data.id != null ? String(data.id) : id,
      status,
      providerStatus: status,
      totalAmountCents: data.total_amount,
      totalPaidCents: data.total_paid,
      occurrenceDate: data.occurrence_date || null,
      paidAt: data.paid_at || paidAtFromPayments || data.occurrence_date || null,
      checkoutUrl: slip && slip.url ? String(slip.url) : '',
      pixPayload: pixEmv,
      boletoUrl: slip && slip.url ? String(slip.url) : '',
      boletoBarcode: slip && slip.digitable ? String(slip.digitable) : '',
      raw: data,
    };
  }

  async cancelCharge(ctx, chargeId) {
    void ctx;
    void chargeId;
    const e = new Error('CORA_CANCEL: não implementado nesta fase');
    e.code = 'CORA_CANCEL';
    throw e;
  }

  async listCharges(ctx, query = {}) {
    void ctx;
    void query;
    return { mode: 'cora_api', items: [], query };
  }

  /**
   * Valida pedido de webhook.
   * Cora documenta User-Agent "Cora-Webhook" e cabeçalhos webhook-event-*.
   * Opção: credentials.webhookInboundSecret na BillingAccount — exige header X-XPDCNET-Webhook-Secret igual (via proxy).
   *
   * Limitação: a API Cora neste fluxo não expõe assinatura HMAC do corpo; a defesa em profundidade é
   * User-Agent + cabeçalhos idempotentes + segredo opcional configurado no proxy + idempotência na base.
   */
  verifyWebhookInbound(account, headers = {}) {
    const cred = (account && account.credentials) || {};
    const ua = headerGet(headers, 'user-agent').toLowerCase();
    if (!ua.includes('cora-webhook')) {
      const e = new Error('Webhook rejeitado: User-Agent inesperado');
      e.code = 'WEBHOOK_UA';
      e.statusCode = 401;
      throw e;
    }
    const eventId = headerGet(headers, 'webhook-event-id');
    const resourceId = headerGet(headers, 'webhook-resource-id');
    if (!eventId && !resourceId) {
      const e = new Error('Webhook rejeitado: identificadores Cora ausentes (webhook-event-id / webhook-resource-id)');
      e.code = 'WEBHOOK_HEADERS';
      e.statusCode = 401;
      throw e;
    }
    const secret = cred.webhookInboundSecret != null ? String(cred.webhookInboundSecret).trim() : '';
    if (secret) {
      const sent = headerGet(headers, 'x-xpdcnet-webhook-secret');
      const a = Buffer.from(String(sent || ''), 'utf8');
      const b = Buffer.from(secret, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        const e = new Error('Webhook rejeitado: segredo inbound inválido');
        e.code = 'WEBHOOK_SECRET';
        e.statusCode = 401;
        throw e;
      }
    }
    return true;
  }

  /**
   * Corpo frequentemente vazio; dados nos headers.
   */
  parseWebhook(rawBody, headers = {}) {
    const eventId = headerGet(headers, 'webhook-event-id');
    const eventType = headerGet(headers, 'webhook-event-type');
    const resourceId = headerGet(headers, 'webhook-resource-id');

    const chargeId = resourceId || (rawBody && (rawBody.id || rawBody.invoice_id)) || null;

    let externalStatus = null;
    if (rawBody && (rawBody.status != null || rawBody.state != null)) {
      externalStatus = String(rawBody.status != null ? rawBody.status : rawBody.state);
    } else if (eventType) {
      const t = eventType.toLowerCase();
      if (t.includes('paid') || t.includes('liquidat')) externalStatus = 'PAID';
      else if (t.includes('cancel')) externalStatus = 'CANCELLED';
      else if (t.includes('late') || t.includes('overdue')) externalStatus = 'LATE';
      else if (t.includes('open')) externalStatus = 'OPEN';
    }

    const bodyKey =
      rawBody && typeof rawBody === 'object'
        ? JSON.stringify(rawBody)
        : String(rawBody || '');
    const stableDedup = crypto
      .createHash('sha256')
      .update(`${eventId}|${eventType}|${resourceId}|${bodyKey}`)
      .digest('hex');

    const providerEventId =
      eventId ||
      (chargeId && eventType ? `cora:${chargeId}:${eventType}` : null) ||
      (chargeId ? `cora:${chargeId}:hdr_missing` : `cora:body:${stableDedup}`);

    return {
      providerEventId,
      eventType: eventType || 'unknown',
      chargeId,
      externalStatus,
      payload: rawBody && typeof rawBody === 'object' ? rawBody : {},
    };
  }

  mapExternalStatusToInternalStatus(externalStatus) {
    const u = String(externalStatus || '')
      .trim()
      .toUpperCase();
    if (['PAID', 'SETTLED', 'RECEIVED', 'CONFIRMED'].includes(u)) return 'paid';
    if (['CANCELLED', 'CANCELED', 'VOIDED'].includes(u)) return 'cancelled';
    if (['LATE', 'OVERDUE'].includes(u)) return 'overdue';
    if (['OPEN', 'DRAFT', 'IN_PAYMENT'].includes(u)) return 'pending';
    const s = String(externalStatus || '')
      .trim()
      .toLowerCase();
    if (['paid', 'settled', 'received'].includes(s)) return 'paid';
    if (['canceled', 'cancelled', 'voided'].includes(s)) return 'cancelled';
    if (['overdue', 'late'].includes(s)) return 'overdue';
    return 'pending';
  }
}

module.exports = CoraBillingAdapter;
