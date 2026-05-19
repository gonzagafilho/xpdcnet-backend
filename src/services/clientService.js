const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const MikrotikServer = require('../models/MikrotikServer');
const clientNetworkPolicyService = require('./clientNetworkPolicyService');
const mikrotikSyncService = require('./mikrotikSyncService');
const networkNodeService = require('./networkNodeService');
const { TRIGGER_REASONS } = require('./mikrotikSyncTriggerCatalog');

/** Converte subdocumento Mongoose ou objeto em plano para merge. */
function asPlain(obj) {
  if (obj == null) return {};
  if (typeof obj.toObject === 'function') return obj.toObject({ flattenMaps: false });
  return { ...obj };
}

/**
 * Merge superficial: chaves presentes em patch substituem/criam; undefined em patch não altera.
 * null no patch limpa o campo (útil para números/datas opcionais).
 */
function mergeSubdoc(existing, patch) {
  if (patch === undefined) return undefined;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return undefined;
  const base = asPlain(existing);
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function changed(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function buildMikrotikSyncTriggerAfterUpdate(existing, data) {
  const reasons = [];
  const changedKeys = [];

  if (data.status !== undefined && data.status !== existing.status) {
    reasons.push(TRIGGER_REASONS.STATUS_CHANGED);
    changedKeys.push('status');
  }
  if (data.planId !== undefined && String(data.planId) !== String(existing.planId)) {
    reasons.push(TRIGGER_REASONS.PLAN_CHANGED);
    changedKeys.push('planId');
  }

  if (data.trustRelease !== undefined) {
    const before = asPlain(existing.trustRelease);
    const after = mergeSubdoc(existing.trustRelease, data.trustRelease);
    if (changed(after, before)) {
      reasons.push(TRIGGER_REASONS.TRUST_RELEASE_CHANGED);
      changedKeys.push('trustRelease');
    }
  }

  if (data.networkAccess !== undefined) {
    const before = asPlain(existing.networkAccess);
    const after = mergeSubdoc(existing.networkAccess, data.networkAccess);
    if (changed(after, before)) {
      reasons.push(TRIGGER_REASONS.NETWORK_ACCESS_CHANGED);
      changedKeys.push('networkAccess');
    }
  }

  if (data.access !== undefined) {
    const before = asPlain(existing.access);
    const after = mergeSubdoc(existing.access, data.access);
    const usernameChanged = after && before ? String(after.username || '') !== String(before.username || '') : false;
    const passwordChanged = after && before ? String(after.password || '') !== String(before.password || '') : false;
    if (usernameChanged || passwordChanged) {
      reasons.push(TRIGGER_REASONS.PPPOE_CREDENTIALS_CHANGED);
      changedKeys.push('access.credentials');
    } else if (changed(after, before)) {
      reasons.push(TRIGGER_REASONS.CLIENT_UPDATED);
      changedKeys.push('access');
    }
  }

  if (data.mikrotik !== undefined) {
    const before = asPlain(existing.mikrotik);
    const after = mergeSubdoc(existing.mikrotik, data.mikrotik);
    if (changed(after, before)) {
      const serverChanged = String(after?.serverId || '') !== String(before?.serverId || '');
      const profileChanged = String(after?.profile || '') !== String(before?.profile || '');
      if (serverChanged) {
        reasons.push(TRIGGER_REASONS.MIKROTIK_SERVER_CHANGED);
        changedKeys.push('mikrotik.serverId');
      }
      if (profileChanged) {
        reasons.push(TRIGGER_REASONS.MIKROTIK_PROFILE_CHANGED);
        changedKeys.push('mikrotik.profile');
      }
      if (!serverChanged && !profileChanged) {
        reasons.push(TRIGGER_REASONS.MIKROTIK_CONFIG_CHANGED);
        changedKeys.push('mikrotik');
      }
    }
  }

  if (reasons.length === 0) return null;
  return {
    triggerReason: reasons[0],
    triggerSource: 'client.update',
    triggerContext: {
      reasons,
      changedKeys,
    },
  };
}

async function safeEnqueueMikrotikSync(tenantId, clientId, trigger) {
  try {
    await mikrotikSyncService.enqueueSync(tenantId, clientId, trigger || {});
  } catch (err) {
    console.error('[mikrotikSync] enqueueSync failed:', err && err.message ? err.message : err);
  }
}

const FINANCE_AUTOMATION_PROTECTED_STATUSES = ['blocked', 'disabled', 'cancelled', 'suspended'];

const DEFAULT_FINANCE_AUTOMATION_MIN_HOLD_MINUTES = 15;

/**
 * Atualização de status disparada apenas pelo worker de consolidação financeira.
 * Não exposta à API HTTP. Dispara enqueue com trigger explícito (FINANCE_ROLLUP).
 *
 * Anti-flapping: se `financeAutomationMinHoldMinutes` em extraContext for > 0 e a última
 * transição automática for mais recente que essa janela, a troca é adiada (skipped).
 * Valores 0 desligam a proteção para o ciclo actual. Rollup deve passar o valor da política.
 *
 * Transições permitidas: active|pending → delinquent; delinquent → active.
 *
 * @param {string} tenantId
 * @param {string|mongoose.Types.ObjectId} clientId
 * @param {'active'|'delinquent'} nextStatus
 * @param {object} [extraContext] — contexto seguro para triggerContext (sem credenciais)
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, client?: object }>}
 */
exports.applyStatusFromFinanceAutomation = async (tenantId, clientId, nextStatus, extraContext = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
    return { ok: false, reason: 'invalid_client_id' };
  }
  const ns = String(nextStatus);
  if (ns !== 'active' && ns !== 'delinquent') {
    return { ok: false, reason: 'invalid_target_status' };
  }

  const extra =
    extraContext && typeof extraContext === 'object' && !Array.isArray(extraContext) ? { ...extraContext } : {};
  const holdConfigured = extra.financeAutomationMinHoldMinutes;
  delete extra.financeAutomationMinHoldMinutes;
  const holdMinRaw = Number(holdConfigured);
  const holdMinutes =
    Number.isFinite(holdMinRaw) && holdMinRaw >= 0 ? Math.min(1440, Math.floor(holdMinRaw)) : DEFAULT_FINANCE_AUTOMATION_MIN_HOLD_MINUTES;
  const holdMs = holdMinutes > 0 ? holdMinutes * 60_000 : 0;

  const existing = await Client.findOne({ _id: clientId, tenantId });
  if (!existing) return { ok: false, reason: 'not_found' };

  if (FINANCE_AUTOMATION_PROTECTED_STATUSES.includes(existing.status)) {
    return { ok: false, reason: 'protected_status', currentStatus: existing.status };
  }

  if (existing.status === ns) {
    return { ok: true, skipped: true, reason: 'no_change' };
  }

  const from = existing.status;
  const allowed =
    (from === 'active' && ns === 'delinquent') ||
    (from === 'pending' && ns === 'delinquent') ||
    (from === 'delinquent' && ns === 'active');

  if (!allowed) {
    return { ok: false, reason: 'disallowed_transition', from, to: ns };
  }

  const lastAtRaw = existing.financeAutomation && existing.financeAutomation.lastAutomaticTransitionAt;
  const lastAt = lastAtRaw ? new Date(lastAtRaw) : null;
  if (holdMs > 0 && lastAt && !Number.isNaN(lastAt.getTime())) {
    const elapsed = Date.now() - lastAt.getTime();
    if (elapsed >= 0 && elapsed < holdMs) {
      return {
        ok: true,
        skipped: true,
        reason: 'anti_flap_hold',
        antiFlap: {
          lastAutomaticTransitionAt: lastAt.toISOString(),
          holdMinutes,
          remainingMs: holdMs - elapsed,
        },
      };
    }
  }

  const transitionReason =
    extra && typeof extra.action === 'string' && extra.action.trim()
      ? String(extra.action).trim()
      : ns === 'delinquent'
        ? 'mark_delinquent'
        : 'restore_active';

  const updated = await Client.findOneAndUpdate(
    { _id: clientId, tenantId },
    {
      $set: {
        status: ns,
        'financeAutomation.lastAutomaticTransitionAt': new Date(),
        'financeAutomation.lastAutomaticTransitionReason': transitionReason,
      },
    },
    { new: true },
  ).populate('planId', 'name speedMbps price authType');

  if (!updated) return { ok: false, reason: 'not_found' };

  await safeEnqueueMikrotikSync(tenantId, clientId, {
    triggerReason: TRIGGER_REASONS.FINANCE_ROLLUP,
    triggerSource: 'scheduler.finance_delinquency_rollup',
    triggerContext: {
      ...extra,
      previousStatus: from,
      nextStatus: ns,
    },
  });

  return { ok: true, skipped: false, client: updated };
};

async function assertMikrotikServerForTenant(tenantId, serverId) {
  if (serverId === null || serverId === undefined || serverId === '') return;
  const sid = String(serverId);
  if (!mongoose.Types.ObjectId.isValid(sid)) {
    throw ApiError.badRequest('mikrotik.serverId inválido');
  }
  const srv = await MikrotikServer.findOne({ _id: sid, tenantId });
  if (!srv) throw ApiError.badRequest('mikrotik.serverId não encontrado para este tenant');
}

exports.create = async (tenantId, data) => {
  const {
    fullName,
    document,
    phone,
    email,
    address,
    geo,
    planId,
    monthlyPrice,
    dueDay,
    access,
    status,
    notes,
    contract,
    networkAccess,
    mikrotik,
    trustRelease,
  } = data;

  if (!fullName || !planId || monthlyPrice === undefined || !access?.username || !access?.password) {
    throw ApiError.badRequest('fullName, planId, monthlyPrice, access.username e access.password são obrigatórios');
  }

  if (!mongoose.Types.ObjectId.isValid(planId)) throw ApiError.badRequest('planId inválido');

  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw ApiError.notFound('Plano não encontrado para este tenant');

  const dd = dueDay ? Number(dueDay) : 10;
  if (dd < 1 || dd > 28) throw ApiError.badRequest('dueDay deve estar entre 1 e 28');

  const payload = {
    tenantId,
    fullName,
    document: document || '',
    phone: phone || '',
    email: email || '',
    address: address || {},
    geo: geo || {},
    planId,
    monthlyPrice: Number(monthlyPrice),
    dueDay: dd,
    access: {
      authType: access?.authType || plan.authType || 'pppoe',
      username: access.username,
      password: access.password,
    },
    status: status || 'active',
    notes: notes || '',
  };

  const mergedContract = mergeSubdoc({}, contract);
  if (mergedContract !== undefined) payload.contract = mergedContract;

  const mergedNetwork = mergeSubdoc({}, networkAccess);
  if (mergedNetwork !== undefined) payload.networkAccess = mergedNetwork;

  const mergedMikrotik = mergeSubdoc({}, mikrotik);
  if (mergedMikrotik !== undefined) payload.mikrotik = mergedMikrotik;

  const mergedTrust = mergeSubdoc({}, trustRelease);
  if (mergedTrust !== undefined) payload.trustRelease = mergedTrust;

  if (
    payload.mikrotik &&
    Object.prototype.hasOwnProperty.call(payload.mikrotik, 'serverId') &&
    payload.mikrotik.serverId
  ) {
    await assertMikrotikServerForTenant(tenantId, payload.mikrotik.serverId);
  }

  const client = await Client.create(payload);

  await safeEnqueueMikrotikSync(tenantId, client._id, {
    triggerReason: TRIGGER_REASONS.CLIENT_CREATED,
    triggerSource: 'client.create',
    triggerContext: {
      status: payload.status || 'active',
      authType: payload.access?.authType || 'pppoe',
      hasServerId: Boolean(payload.mikrotik && payload.mikrotik.serverId),
    },
  });

  return client;
};

exports.list = async (tenantId, query = {}) => {
  const filter = { tenantId };

  if (query.status) filter.status = query.status;
  if (query.search) {
    filter.$or = [
      { fullName: { $regex: query.search, $options: 'i' } },
      { document: { $regex: query.search, $options: 'i' } },
      { 'access.username': { $regex: query.search, $options: 'i' } },
    ];
  }

  return Client.find(filter)
    .sort({ createdAt: -1 })
    .populate('planId', 'name speedMbps price authType');
};

exports.getById = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const client = await Client.findOne({ _id: id, tenantId }).populate('planId', 'name speedMbps price authType');
  if (!client) throw ApiError.notFound('Cliente não encontrado');

  return client;
};

/** Leitura: política de rede / intenção MikroTik (sem RouterOS). */
exports.getNetworkIntent = async (tenantId, id) => {
  const client = await exports.getById(tenantId, id);
  return clientNetworkPolicyService.resolveNetworkIntent(client);
};

exports.update = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const existing = await Client.findOne({ _id: id, tenantId });
  if (!existing) throw ApiError.notFound('Cliente não encontrado');

  const syncTrigger = buildMikrotikSyncTriggerAfterUpdate(existing, data);

  if (data.planId) {
    if (!mongoose.Types.ObjectId.isValid(data.planId)) throw ApiError.badRequest('planId inválido');

    const plan = await Plan.findOne({ _id: data.planId, tenantId });
    if (!plan) throw ApiError.notFound('Plano não encontrado para este tenant');
  }

  if (data.dueDay !== undefined) {
    const dd = Number(data.dueDay);
    if (dd < 1 || dd > 28) throw ApiError.badRequest('dueDay deve estar entre 1 e 28');
    data.dueDay = dd;
  }

  const $set = {};

  if (data.fullName !== undefined) $set.fullName = data.fullName;
  if (data.document !== undefined) $set.document = data.document;
  if (data.phone !== undefined) $set.phone = data.phone;
  if (data.email !== undefined) $set.email = data.email;
  if (data.planId !== undefined) $set.planId = data.planId;
  if (data.monthlyPrice !== undefined) $set.monthlyPrice = Number(data.monthlyPrice);
  if (data.dueDay !== undefined) $set.dueDay = data.dueDay;
  if (data.status !== undefined) $set.status = data.status;
  if (data.notes !== undefined) $set.notes = data.notes;

  const mergedAddress = mergeSubdoc(existing.address, data.address);
  if (mergedAddress !== undefined) $set.address = mergedAddress;

  const mergedGeo = mergeSubdoc(existing.geo, data.geo);
  if (mergedGeo !== undefined) $set.geo = mergedGeo;

  const mergedAccess = mergeSubdoc(existing.access, data.access);
  if (mergedAccess !== undefined) $set.access = mergedAccess;

  const mergedContract = mergeSubdoc(existing.contract, data.contract);
  if (mergedContract !== undefined) $set.contract = mergedContract;

  const mergedNetwork = mergeSubdoc(existing.networkAccess, data.networkAccess);
  if (mergedNetwork !== undefined) $set.networkAccess = mergedNetwork;

  const mergedMikrotik = mergeSubdoc(existing.mikrotik, data.mikrotik);
  if (mergedMikrotik !== undefined) $set.mikrotik = mergedMikrotik;

  if (data.trustRelease !== undefined) {
    const mergedTrust = mergeSubdoc(existing.trustRelease, data.trustRelease);
    if (mergedTrust !== undefined) {
      const plainTrust = { ...asPlain(mergedTrust) };
      if (!plainTrust.enabled || clientNetworkPolicyService.isTrustReleaseActive(plainTrust, new Date())) {
        plainTrust.lastExpiryEnqueueForUntil = null;
      }
      $set.trustRelease = plainTrust;
    }
  }

  if (data.networkNodeId !== undefined) {
    if (data.networkNodeId === null || data.networkNodeId === '') {
      $set.networkNodeId = null;
    } else {
      if (!mongoose.Types.ObjectId.isValid(String(data.networkNodeId))) {
        throw ApiError.badRequest('networkNodeId inválido');
      }
      await networkNodeService.getNode(tenantId, String(data.networkNodeId));
      $set.networkNodeId = data.networkNodeId;
    }
  }

  if (
    $set.mikrotik &&
    Object.prototype.hasOwnProperty.call($set.mikrotik, 'serverId') &&
    $set.mikrotik.serverId
  ) {
    await assertMikrotikServerForTenant(tenantId, $set.mikrotik.serverId);
  }

  const updated = await Client.findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true }).populate(
    'planId',
    'name speedMbps price authType'
  );

  if (!updated) throw ApiError.notFound('Cliente não encontrado');

  if (syncTrigger) {
    await safeEnqueueMikrotikSync(tenantId, id, syncTrigger);
  }

  return updated;
};

exports.remove = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const deleted = await Client.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('Cliente não encontrado');

  return true;
};
