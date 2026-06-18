const crypto = require('crypto');
const PaymentGatewayTransaction = require('../../models/billing/PaymentGatewayTransaction');
const BillingInvoice = require('../../models/billing/BillingInvoice');
const BillingCustomer = require('../../models/billing/BillingCustomer');

const MP_API_BASE = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado');
  }
  return token;
}

function centsToAmount(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function getInvoiceAmountCents(invoice) {
  return (
    invoice.amountCents ||
    invoice.totalCents ||
    invoice.valueCents ||
    Math.round(Number(invoice.amount || invoice.value || 0) * 100)
  );
}

function getCustomerName(customer) {
  return (
    customer?.name ||
    customer?.fullName ||
    customer?.legalName ||
    customer?.customerName ||
    'Cliente DC NET'
  );
}

function getCustomerEmail(customer) {
  return (
    customer?.email ||
    process.env.BOLEPIX_DEFAULT_EMAIL ||
    'cliente@dcnet.local'
  );
}

function getCustomerDocument(customer) {
  const raw =
    customer?.cpfCnpj ||
    customer?.document ||
    customer?.cpf ||
    customer?.cnpj ||
    '';

  return String(raw).replace(/\D/g, '');
}

async function mpRequest(path, options = {}) {
  const res = await fetch(`${MP_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `Mercado Pago erro ${res.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function createPixForInvoice(invoiceId) {
  const invoice = await BillingInvoice.findById(invoiceId).lean();

  if (!invoice) {
    throw new Error('Fatura não encontrada');
  }

  const customerId =
    invoice.customerId ||
    invoice.billingCustomerId ||
    invoice.customer ||
    invoice.clientId;

  const customer = customerId
    ? await BillingCustomer.findById(customerId).lean()
    : null;

  const amountCents = getInvoiceAmountCents(invoice);

  if (!amountCents || amountCents <= 0) {
    throw new Error('Valor da fatura inválido');
  }

  const existing = await PaymentGatewayTransaction.findOne({
    invoiceId: invoice._id,
    gateway: 'mercadopago',
    status: { $in: ['pending', 'in_process', 'approved', 'paid'] },
  }).lean();

  if (existing) {
    return existing;
  }

  const externalReference = `xpdcnet_invoice_${invoice._id}`;

  const payer = {
    email: getCustomerEmail(customer),
    first_name: getCustomerName(customer),
  };

  const document = getCustomerDocument(customer);

  if (document.length === 11 || document.length === 14) {
    payer.identification = {
      type: document.length === 11 ? 'CPF' : 'CNPJ',
      number: document,
    };
  }

  const body = {
    transaction_amount: centsToAmount(amountCents),
    description: `DC NET - Fatura ${invoice.reference || invoice._id}`,
    payment_method_id: 'pix',
    external_reference: externalReference,
    payer,
  };

  const idempotencyKey = crypto
    .createHash('sha256')
    .update(externalReference)
    .digest('hex');

  const payment = await mpRequest('/v1/payments', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const point =
    payment.point_of_interaction?.transaction_data || {};

  const tx = await PaymentGatewayTransaction.create({
    gateway: 'mercadopago',
    invoiceId: invoice._id,
    customerId,
    externalId: String(payment.id),
    externalReference,
    status: payment.status || 'pending',
    amountCents,
    dueDate: invoice.dueDate || invoice.expiresAt,
    qrCode: point.qr_code,
    qrCodeBase64: point.qr_code_base64,
    ticketUrl: point.ticket_url,
    rawCreateResponse: payment,
    rawLastStatusResponse: payment,
    lastCheckedAt: new Date(),
  });

  return tx.toObject();
}

async function getPayment(paymentId) {
  return mpRequest(`/v1/payments/${paymentId}`, {
    method: 'GET',
  });
}

async function syncPaymentStatus(paymentId) {
  const payment = await getPayment(paymentId);

  const tx = await PaymentGatewayTransaction.findOne({
    gateway: 'mercadopago',
    externalId: String(payment.id),
  });

  if (!tx) {
    return { ok: false, reason: 'transaction_not_found', payment };
  }

  tx.status = payment.status || tx.status;
  tx.rawLastStatusResponse = payment;
  tx.lastCheckedAt = new Date();

  if (payment.status === 'approved') {
    tx.paidAt = payment.date_approved
      ? new Date(payment.date_approved)
      : new Date();

    await markInvoiceAsPaid(tx.invoiceId, tx.paidAt, payment);
  }

  await tx.save();

  return { ok: true, transaction: tx, payment };
}

async function markInvoiceAsPaid(invoiceId, paidAt, payment) {
  const invoice = await BillingInvoice.findById(invoiceId);

  if (!invoice) return null;

  invoice.status = 'paid';
  invoice.paidAt = paidAt || new Date();

  if ('paymentMethod' in invoice) invoice.paymentMethod = 'pix';
  if ('gateway' in invoice) invoice.gateway = 'mercadopago';
  if ('gatewayPaymentId' in invoice) invoice.gatewayPaymentId = String(payment.id);

  await invoice.save();
  return invoice;
}

async function handleWebhook(payload) {
  const type = payload.type || payload.action || payload.topic;
  const paymentId =
    payload?.data?.id ||
    payload?.id ||
    payload?.resource;

  if (!paymentId) {
    return { ok: false, reason: 'payment_id_not_found', payload };
  }

  const result = await syncPaymentStatus(paymentId);

  await PaymentGatewayTransaction.updateOne(
    {
      gateway: 'mercadopago',
      externalId: String(paymentId),
    },
    {
      $set: {
        rawWebhookPayload: payload,
        webhookReceivedAt: new Date(),
      },
    }
  );

  return {
    ok: true,
    type,
    paymentId,
    result,
  };
}

async function reconcilePendingPayments(limit = 50) {
  const pending = await PaymentGatewayTransaction.find({
    gateway: 'mercadopago',
    status: { $in: ['pending', 'in_process'] },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  const results = [];

  for (const tx of pending) {
    try {
      const result = await syncPaymentStatus(tx.externalId);
      results.push({ externalId: tx.externalId, ok: true, result });
    } catch (err) {
      tx.errorMessage = err.message;
      tx.lastCheckedAt = new Date();
      await tx.save();
      results.push({ externalId: tx.externalId, ok: false, error: err.message });
    }
  }

  return results;
}

module.exports = {
  createPixForInvoice,
  getPayment,
  syncPaymentStatus,
  handleWebhook,
  reconcilePendingPayments,
};
