/**
 * Consolidação financeira → Client.status → enqueue MikroTik (via clientService.applyStatusFromFinanceAutomation).
 * Só MongoDB; não chama RouterOS.
 */

const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Tenant = require('../models/Tenant');
const clientService = require('./clientService');
const { DEFAULT_FINANCE_POLICY } = require('./tenantService');

function clampHoldMinutes(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_FINANCE_POLICY.financeAutomationMinHoldMinutes;
  return Math.min(1440, Math.max(0, Math.floor(v)));
}

const LOG_PREFIX = '[xpdcnet-finance-rollup]';

/**
 * pending com dueDate < agora → overdue (por tenant).
 * @param {mongoose.Types.ObjectId|string} tenantId
 * @param {Date} [now]
 * @returns {Promise<number>} modifiedCount
 */
async function markPendingInvoicesOverdueForTenant(tenantId, now = new Date()) {
  const r = await Invoice.updateMany(
    { tenantId, status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } },
  );
  return r.modifiedCount;
}

/**
 * @param {mongoose.Types.ObjectId|string} tenantId
 * @returns {Promise<string[]>} clientIds (string)
 */
async function distinctClientIdsWithOverdue(tenantId) {
  const rows = await Invoice.distinct('clientId', { tenantId, status: 'overdue' });
  return rows.map((id) => String(id));
}

function normalizeFinancePolicy(tenantDoc) {
  const p = (tenantDoc && tenantDoc.financePolicy) || {};
  return {
    financeAutomationEnabled:
      typeof p.financeAutomationEnabled === 'boolean'
        ? p.financeAutomationEnabled
        : DEFAULT_FINANCE_POLICY.financeAutomationEnabled,
    financeGraceDays:
      typeof p.financeGraceDays === 'number' ? p.financeGraceDays : DEFAULT_FINANCE_POLICY.financeGraceDays,
    financeMinOverdueInvoices:
      typeof p.financeMinOverdueInvoices === 'number'
        ? p.financeMinOverdueInvoices
        : DEFAULT_FINANCE_POLICY.financeMinOverdueInvoices,
    financeCutoffWindowEnabled:
      typeof p.financeCutoffWindowEnabled === 'boolean'
        ? p.financeCutoffWindowEnabled
        : DEFAULT_FINANCE_POLICY.financeCutoffWindowEnabled,
    financeCutoffStartHour:
      typeof p.financeCutoffStartHour === 'number'
        ? p.financeCutoffStartHour
        : DEFAULT_FINANCE_POLICY.financeCutoffStartHour,
    financeCutoffEndHour:
      typeof p.financeCutoffEndHour === 'number'
        ? p.financeCutoffEndHour
        : DEFAULT_FINANCE_POLICY.financeCutoffEndHour,
    financeAutoReactivateWhenClear:
      typeof p.financeAutoReactivateWhenClear === 'boolean'
        ? p.financeAutoReactivateWhenClear
        : DEFAULT_FINANCE_POLICY.financeAutoReactivateWhenClear,
    financeAutomationMinHoldMinutes: clampHoldMinutes(p.financeAutomationMinHoldMinutes),
    financeTimezone:
      p.financeTimezone && String(p.financeTimezone).trim()
        ? String(p.financeTimezone).trim()
        : DEFAULT_FINANCE_POLICY.financeTimezone,
  };
}

function hourInTimezone(now, timezone) {
  try {
    const hourRaw = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(now);
    return Number(hourRaw);
  } catch (_) {
    const hourRaw = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      hour12: false,
    }).format(now);
    return Number(hourRaw);
  }
}

function withinCutoffWindow(policy, now) {
  if (!policy.financeCutoffWindowEnabled) return true;
  const start = policy.financeCutoffStartHour;
  const end = policy.financeCutoffEndHour;
  const h = hourInTimezone(now, policy.financeTimezone);
  if (!Number.isInteger(h)) return false;
  if (start === end) return true; // janela de 24h
  if (start < end) return h >= start && h < end;
  return h >= start || h < end; // atravessa meia-noite
}

function daysLate(now, dueDate) {
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) return 0;
  const diffMs = now.getTime() - dueDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 86_400_000);
}

/**
 * Um ciclo por tenant.
 * @param {mongoose.Types.ObjectId|string} tenantId
 * @param {Date} [now]
 */
exports.runFinanceRollupTickForTenant = async (tenantLike, now = new Date()) => {
  const tid = tenantLike && tenantLike._id ? tenantLike._id : tenantLike;
  const policy = normalizeFinancePolicy(tenantLike);

  let invoicesMarkedOverdue = 0;
  let toDelinquent = 0;
  let toActive = 0;
  let skippedProtected = 0;
  let skippedNoChange = 0;
  let skippedPolicy = 0;
  let skippedAntiFlap = 0;

  invoicesMarkedOverdue += await markPendingInvoicesOverdueForTenant(tid, now);

  const overdueClientIds = await distinctClientIdsWithOverdue(tid);
  const canCutoffNow = withinCutoffWindow(policy, now);

  for (const cidStr of overdueClientIds) {
    if (!mongoose.Types.ObjectId.isValid(cidStr)) continue;
    const overdueInvoices = await Invoice.find({
      tenantId: tid,
      clientId: cidStr,
      status: 'overdue',
    })
      .select('dueDate')
      .lean();
    const overdueInvoiceCount = overdueInvoices.length;
    const maxDaysLate = overdueInvoices.reduce((maxDays, inv) => {
      const d = daysLate(now, inv && inv.dueDate ? new Date(inv.dueDate) : null);
      return d > maxDays ? d : maxDays;
    }, 0);

    const meetsInvoiceCount = overdueInvoiceCount >= policy.financeMinOverdueInvoices;
    const meetsGraceDays = maxDaysLate >= policy.financeGraceDays;
    const eligibleForDelinquent =
      policy.financeAutomationEnabled && meetsInvoiceCount && meetsGraceDays && canCutoffNow;
    if (!eligibleForDelinquent) {
      skippedPolicy += 1;
      continue;
    }

    const res = await clientService.applyStatusFromFinanceAutomation(tid, cidStr, 'delinquent', {
      action: 'mark_delinquent',
      financeAutomationMinHoldMinutes: policy.financeAutomationMinHoldMinutes,
      overdueInvoiceCount,
      maxDaysLate,
      financeGraceDays: policy.financeGraceDays,
      financeMinOverdueInvoices: policy.financeMinOverdueInvoices,
      financeCutoffWindowEnabled: policy.financeCutoffWindowEnabled,
      financeTimezone: policy.financeTimezone,
    });

    if (res.ok && res.skipped && res.reason === 'anti_flap_hold') skippedAntiFlap += 1;
    else if (res.ok && res.skipped) skippedNoChange += 1;
    else if (res.ok && !res.skipped) toDelinquent += 1;
    else if (res.reason === 'protected_status') skippedProtected += 1;
  }

  const delinquentClients = await Client.find({ tenantId: tid, status: 'delinquent' }).select('_id').lean();

  for (const c of delinquentClients) {
    const cid = c._id;
    const overdueCount = await Invoice.countDocuments({ tenantId: tid, clientId: cid, status: 'overdue' });
    if (overdueCount > 0) continue;
    if (!policy.financeAutomationEnabled || !policy.financeAutoReactivateWhenClear) {
      skippedPolicy += 1;
      continue;
    }

    const res = await clientService.applyStatusFromFinanceAutomation(tid, cid, 'active', {
      action: 'restore_active',
      financeAutomationMinHoldMinutes: policy.financeAutomationMinHoldMinutes,
      overdueInvoiceCount: 0,
      financeAutoReactivateWhenClear: policy.financeAutoReactivateWhenClear,
    });

    if (res.ok && res.skipped && res.reason === 'anti_flap_hold') skippedAntiFlap += 1;
    else if (res.ok && res.skipped) skippedNoChange += 1;
    else if (res.ok && !res.skipped) toActive += 1;
    else if (res.reason === 'protected_status') skippedProtected += 1;
  }

  return {
    invoicesMarkedOverdue,
    overdueClientsSeen: overdueClientIds.length,
    toDelinquent,
    toActive,
    skippedProtected,
    skippedPolicy,
    skippedNoChange,
    skippedAntiFlap,
  };
};

/**
 * Todos os tenants activos.
 * @param {object} [opts]
 * @param {Date} [opts.now]
 */
exports.runFinanceRollupGlobal = async (opts = {}) => {
  const now = opts.now || new Date();
  const tenants = await Tenant.find({ isActive: { $ne: false } })
    .select('_id financePolicy')
    .lean();

  let invoicesMarkedOverdue = 0;
  let overdueClientsSeen = 0;
  let toDelinquent = 0;
  let toActive = 0;
  let skippedProtected = 0;
  let skippedPolicy = 0;
  let skippedNoChange = 0;
  let skippedAntiFlap = 0;

  for (const t of tenants) {
    const r = await exports.runFinanceRollupTickForTenant(t, now);
    invoicesMarkedOverdue += r.invoicesMarkedOverdue;
    overdueClientsSeen += r.overdueClientsSeen;
    toDelinquent += r.toDelinquent;
    toActive += r.toActive;
    skippedProtected += r.skippedProtected;
    skippedPolicy += r.skippedPolicy;
    skippedNoChange += r.skippedNoChange;
    skippedAntiFlap += r.skippedAntiFlap || 0;
  }

  if (tenants.length > 0) {
    console.log(
      `${LOG_PREFIX} tick tenants=%d invoicesPending→overdue=%d overdueClientsSeen=%d delinquent=%d active=%d protected=%d policySkip=%d noChange=%d antiFlap=%d`,
      tenants.length,
      invoicesMarkedOverdue,
      overdueClientsSeen,
      toDelinquent,
      toActive,
      skippedProtected,
      skippedPolicy,
      skippedNoChange,
      skippedAntiFlap,
    );
  }

  return {
    tenants: tenants.length,
    invoicesMarkedOverdue,
    overdueClientsSeen,
    toDelinquent,
    toActive,
    skippedProtected,
    skippedPolicy,
    skippedNoChange,
    skippedAntiFlap,
  };
};

exports.LOG_PREFIX = LOG_PREFIX;
