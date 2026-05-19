/**
 * Auditoria operacional MikrotikSyncJob — mensagens limitadas, sem passwords.
 */

const { scrubSecretsFromMessage } = require('../integrations/mikrotik/mikrotikClient');

const MAX_AUDIT_MESSAGE_LEN = 2000;
const MAX_AUDIT_ERROR_LEN = 500;

function trimLen(s, max) {
  const t = s != null ? String(s) : '';
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Subconjunto seguro do intent (sem credenciais PPPoE).
 * @param {object|null|undefined} intentSnapshot
 * @returns {object|null}
 */
function pickExpectedSnapshot(intentSnapshot) {
  if (!intentSnapshot || typeof intentSnapshot !== 'object') return null;
  return {
    clientId: intentSnapshot.clientId != null ? String(intentSnapshot.clientId) : null,
    status: intentSnapshot.status != null ? String(intentSnapshot.status) : null,
    recommendedSyncGoal:
      intentSnapshot.recommendedSyncGoal != null ? String(intentSnapshot.recommendedSyncGoal) : null,
    effectiveAccess: intentSnapshot.effectiveAccess != null ? String(intentSnapshot.effectiveAccess) : null,
  };
}

/**
 * @param {object} raw
 * @returns {object}
 */
function normalizeAuditPayload(raw) {
  const mode = raw.executionMode != null ? trimLen(String(raw.executionMode), 32) : '';
  const action = raw.executionAction != null ? trimLen(String(raw.executionAction), 32) : '';
  const msg = trimLen(scrubSecretsFromMessage(String(raw.executionMessage ?? '')), MAX_AUDIT_MESSAGE_LEN);
  const err = trimLen(scrubSecretsFromMessage(String(raw.executionError ?? '')), MAX_AUDIT_ERROR_LEN);
  const executedAt =
    raw.executedAt instanceof Date && !Number.isNaN(raw.executedAt.getTime())
      ? raw.executedAt
      : new Date();
  const expectedSnapshot =
    raw.expectedSnapshot != null && typeof raw.expectedSnapshot === 'object'
      ? pickExpectedSnapshot(raw.expectedSnapshot)
      : null;

  return {
    executionMode: mode || null,
    executionAction: action || null,
    executionMessage: msg,
    executionError: err,
    executedAt,
    expectedSnapshot,
  };
}

module.exports = {
  pickExpectedSnapshot,
  normalizeAuditPayload,
  MAX_AUDIT_MESSAGE_LEN,
  MAX_AUDIT_ERROR_LEN,
};
