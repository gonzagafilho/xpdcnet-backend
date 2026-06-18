const ApiError = require('../errors/ApiError');

const DEFAULT_GRAPH_VERSION = 'v25.0';
const SEND_TIMEOUT_MS = 10000;

function onlyDigits(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function formatBrazilWhatsAppPhone(value) {
  const digits = onlyDigits(value);
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function getWhatsAppConfig() {
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const token = String(process.env.WHATSAPP_TOKEN || '').trim();
  const graphVersion = String(process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim() || DEFAULT_GRAPH_VERSION;

  if (!phoneNumberId || !token) {
    throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN');
  }

  return { phoneNumberId, token, graphVersion };
}

async function fetchWithTimeout(url, options, timeoutMs = SEND_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildOtpMessage(code) {
  return `Seu código de acesso DC NET é: ${code}. Ele expira em 5 minutos.`;
}

async function sendWhatsAppText(to, message) {
  if (typeof fetch !== 'function') {
    throw new Error('Node.js 18+ requerido para envio WhatsApp via fetch nativo');
  }

  const { phoneNumberId, token, graphVersion } = getWhatsAppConfig();
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message },
  };

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`WhatsApp send failed: ${response.status}`);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return data;
}

async function sendCustomerOtp(phone, code) {
  const to = formatBrazilWhatsAppPhone(phone);
  if (!to) throw ApiError.badRequest('phone invalido');

  const message = buildOtpMessage(code);
  try {
    const sent = await sendWhatsAppText(to, message);
    console.log('[customer_otp_whatsapp] sent', {
      to,
      wamid: sent?.messages?.[0]?.id || '',
    });
    return { ok: true, to, data: sent };
  } catch (err) {
    console.error('[customer_otp_whatsapp] send_failed', {
      to,
      status: err?.status || null,
      message: err?.message || String(err),
      response: err?.response || null,
    });
    throw ApiError.serviceUnavailable('Não foi possível enviar o código pelo WhatsApp agora.', 'CUSTOMER_OTP_WHATSAPP_SEND_FAILED');
  }
}

module.exports = {
  buildOtpMessage,
  formatBrazilWhatsAppPhone,
  sendCustomerOtp,
};
