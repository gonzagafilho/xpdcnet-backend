const { scrubSecretsFromMessage } = require('../integrations/mikrotik/mikrotikClient');

const TRIGGER_REASONS = Object.freeze({
  CLIENT_CREATED: 'CLIENT_CREATED',
  CLIENT_UPDATED: 'CLIENT_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  TRUST_RELEASE_CHANGED: 'TRUST_RELEASE_CHANGED',
  NETWORK_ACCESS_CHANGED: 'NETWORK_ACCESS_CHANGED',
  MIKROTIK_SERVER_CHANGED: 'MIKROTIK_SERVER_CHANGED',
  MIKROTIK_PROFILE_CHANGED: 'MIKROTIK_PROFILE_CHANGED',
  MIKROTIK_CONFIG_CHANGED: 'MIKROTIK_CONFIG_CHANGED',
  PPPOE_CREDENTIALS_CHANGED: 'PPPOE_CREDENTIALS_CHANGED',
  PLAN_CHANGED: 'PLAN_CHANGED',
  /** Scheduler: confiança expirou (until passou); re-sync alinhado à política actual. */
  TRUST_RELEASE_EXPIRED: 'TRUST_RELEASE_EXPIRED',
  /** Scheduler: consolidação financeira alterou Client.status (inadimplência / regularização). */
  FINANCE_ROLLUP: 'FINANCE_ROLLUP',
  /** Admin: reconciliação manual explícita quando leitura detecta divergência policy × MikroTik. */
  DIVERGENCE_MANUAL_RECONCILE: 'DIVERGENCE_MANUAL_RECONCILE',
});

const MAX_TRIGGER_REASON_LEN = 64;
const MAX_TRIGGER_SOURCE_LEN = 64;
const MAX_TRIGGER_STRING_LEN = 240;
const MAX_TRIGGER_OBJECT_KEYS = 30;
const MAX_TRIGGER_ARRAY_ITEMS = 20;
const MAX_TRIGGER_DEPTH = 3;

function trimTo(s, max) {
  const t = s != null ? String(s) : '';
  return t.length > max ? t.slice(0, max) : t;
}

function pruneContext(value, depth = 0) {
  if (depth > MAX_TRIGGER_DEPTH) return undefined;
  if (value == null) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return trimTo(scrubSecretsFromMessage(value), MAX_TRIGGER_STRING_LEN);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TRIGGER_ARRAY_ITEMS)
      .map((item) => pruneContext(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    let count = 0;
    for (const [key, raw] of Object.entries(value)) {
      if (count >= MAX_TRIGGER_OBJECT_KEYS) break;
      if (/(password|secret|credential|token)/i.test(key)) continue;
      const cleaned = pruneContext(raw, depth + 1);
      if (cleaned === undefined) continue;
      out[String(key)] = cleaned;
      count += 1;
    }
    return out;
  }
  return undefined;
}

function normalizeTriggerPayload(trigger = {}) {
  const triggerReason = trigger.triggerReason
    ? trimTo(trigger.triggerReason, MAX_TRIGGER_REASON_LEN).toUpperCase()
    : null;
  const triggerSource = trigger.triggerSource ? trimTo(trigger.triggerSource, MAX_TRIGGER_SOURCE_LEN) : null;
  const triggerContext =
    trigger.triggerContext && typeof trigger.triggerContext === 'object'
      ? pruneContext(trigger.triggerContext, 0)
      : null;
  return { triggerReason, triggerSource, triggerContext };
}

module.exports = {
  TRIGGER_REASONS,
  normalizeTriggerPayload,
};
