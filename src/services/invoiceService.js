const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Tenant = require('../models/Tenant');
const { DEFAULT_FINANCE_POLICY } = require('./tenantService');

const STATUSES = ['pending', 'paid', 'overdue', 'cancelled'];

const DUPLICATE_KEY_CODE = 11000;
const INVOICE_DUPLICATE_CODE = 'INVOICE_DUPLICATE_COMPETENCE';
const PROTECTED_CLIENT_STATUSES = ['blocked', 'disabled', 'cancelled', 'suspended'];

function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === DUPLICATE_KEY_CODE || err.code === 11001));
}

function assertCompetence(value) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value.trim())) {
    throw ApiError.badRequest('competence é obrigatório e deve estar no formato YYYY-MM');
  }
  return value.trim();
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
    financeAutomationMinHoldMinutes: (() => {
      const raw = p.financeAutomationMinHoldMinutes;
      if (raw === undefined || raw === null) return DEFAULT_FINANCE_POLICY.financeAutomationMinHoldMinutes;
      const n = Number(raw);
      if (!Number.isFinite(n)) return DEFAULT_FINANCE_POLICY.financeAutomationMinHoldMinutes;
      return Math.min(1440, Math.max(0, Math.floor(n)));
    })(),
    financeTimezone:
      p.financeTimezone && String(p.financeTimezone).trim()
        ? String(p.financeTimezone).trim()
        : DEFAULT_FINANCE_POLICY.financeTimezone,
  };
}

function antiFlapSnapshot(now, policy, financeAutomationDoc) {
  const holdMinutes = policy.financeAutomationMinHoldMinutes;
  const lastRaw = financeAutomationDoc && financeAutomationDoc.lastAutomaticTransitionAt;
  const lastAt = lastRaw ? new Date(lastRaw) : null;
  let inHoldWindow = false;
  let remainingMs = null;
  if (holdMinutes > 0 && lastAt && !Number.isNaN(lastAt.getTime())) {
    const holdMs = holdMinutes * 60_000;
    const elapsed = now.getTime() - lastAt.getTime();
    if (elapsed >= 0 && elapsed < holdMs) {
      inHoldWindow = true;
      remainingMs = holdMs - elapsed;
    }
  }
  return {
    holdMinutes,
    lastAutomaticTransitionAt: lastAt && !Number.isNaN(lastAt.getTime()) ? lastAt.toISOString() : null,
    lastAutomaticTransitionReason:
      financeAutomationDoc && financeAutomationDoc.lastAutomaticTransitionReason != null
        ? String(financeAutomationDoc.lastAutomaticTransitionReason)
        : '',
    inHoldWindow,
    remainingMs,
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
  if (start === end) return true;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

function daysLate(now, dueDate) {
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) return 0;
  const diffMs = now.getTime() - dueDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 86_400_000);
}

exports.create = async (tenantId, data) => {
  const { clientId, planId, amount, dueDate, status, paidAt, competence, description } = data;

  if (!clientId || amount === undefined || !dueDate || !status) {
    throw ApiError.badRequest('clientId, amount, dueDate e status são obrigatórios');
  }

  if (!STATUSES.includes(status)) {
    throw ApiError.badRequest(`status deve ser um de: ${STATUSES.join(', ')}`);
  }

  if (!planId) {
    throw ApiError.badRequest('planId é obrigatório');
  }

  if (!mongoose.Types.ObjectId.isValid(clientId)) throw ApiError.badRequest('clientId inválido');
  if (!mongoose.Types.ObjectId.isValid(planId)) throw ApiError.badRequest('planId inválido');

  const competenceVal = assertCompetence(competence);

  const client = await Client.findOne({ _id: clientId, tenantId });
  if (!client) throw ApiError.notFound('Cliente não encontrado para este tenant');

  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw ApiError.notFound('Plano não encontrado para este tenant');

  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) throw ApiError.badRequest('dueDate inválida');

  const numAmount = Number(amount);
  if (Number.isNaN(numAmount) || numAmount < 0) throw ApiError.badRequest('amount inválido');

  let paidAtDate = null;
  if (status === 'paid') {
    paidAtDate = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(paidAtDate.getTime())) throw ApiError.badRequest('paidAt inválido');
  }

  try {
    return await Invoice.create({
      tenantId,
      clientId,
      planId,
      amount: numAmount,
      dueDate: due,
      status,
      paidAt: paidAtDate,
      competence: competenceVal,
      description: description || '',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(
        'Já existe cobrança para este cliente nesta competência.',
        INVOICE_DUPLICATE_CODE,
      );
    }
    throw err;
  }
};

exports.list = async (tenantId, query = {}) => {
  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) };

  if (query.status && STATUSES.includes(query.status)) filter.status = query.status;
  if (query.clientId && mongoose.Types.ObjectId.isValid(query.clientId)) {
    filter.clientId = new mongoose.Types.ObjectId(query.clientId);
  }
  if (query.competence) {
    try {
      filter.competence = assertCompetence(query.competence);
    } catch {
      throw ApiError.badRequest('competence na query deve estar no formato YYYY-MM');
    }
  }

  return Invoice.find(filter)
    .sort({ dueDate: -1 })
    .populate('clientId', 'fullName phone email')
    .populate('planId', 'name speedMbps price');
};

/**
 * Agregados por status para o tenant, com os mesmos filtros opcionais que list (status, clientId, competence).
 */
exports.summary = async (tenantId, query = {}) => {
  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) };

  let statusApplied = null;
  if (query.status && STATUSES.includes(query.status)) {
    filter.status = query.status;
    statusApplied = query.status;
  }

  let clientIdApplied = null;
  if (query.clientId && mongoose.Types.ObjectId.isValid(query.clientId)) {
    filter.clientId = new mongoose.Types.ObjectId(query.clientId);
    clientIdApplied = query.clientId;
  }

  let competenceApplied = null;
  if (query.competence) {
    try {
      competenceApplied = assertCompetence(query.competence);
      filter.competence = competenceApplied;
    } catch {
      throw ApiError.badRequest('competence na query deve estar no formato YYYY-MM');
    }
  }

  const agg = await Invoice.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
  ]);

  const emptyBlock = () => ({ count: 0, amount: 0 });
  const byStatus = {
    pending: emptyBlock(),
    paid: emptyBlock(),
    overdue: emptyBlock(),
    cancelled: emptyBlock(),
  };

  let totalInvoices = 0;
  let totalAmount = 0;

  for (const row of agg) {
    const s = row._id;
    if (byStatus[s]) {
      byStatus[s].count = row.count;
      byStatus[s].amount = row.totalAmount;
    }
    totalInvoices += row.count;
    totalAmount += row.totalAmount;
  }

  return {
    pending: byStatus.pending,
    paid: byStatus.paid,
    overdue: byStatus.overdue,
    cancelled: byStatus.cancelled,
    totalInvoices,
    totalAmount,
    filters: {
      competence: competenceApplied,
      clientId: clientIdApplied,
      status: statusApplied,
    },
  };
};

exports.getById = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const invoice = await Invoice.findOne({ _id: id, tenantId })
    .populate('clientId', 'fullName phone email')
    .populate('planId', 'name speedMbps price authType');

  if (!invoice) throw ApiError.notFound('Cobrança não encontrada');

  return invoice;
};

exports.update = async (tenantId, id, data) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const patch = {};

  if (data.clientId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(data.clientId)) throw ApiError.badRequest('clientId inválido');
    const client = await Client.findOne({ _id: data.clientId, tenantId });
    if (!client) throw ApiError.notFound('Cliente não encontrado para este tenant');
    patch.clientId = data.clientId;
  }

  if (data.planId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(data.planId)) throw ApiError.badRequest('planId inválido');
    const plan = await Plan.findOne({ _id: data.planId, tenantId });
    if (!plan) throw ApiError.notFound('Plano não encontrado para este tenant');
    patch.planId = data.planId;
  }

  if (data.amount !== undefined) {
    const n = Number(data.amount);
    if (Number.isNaN(n) || n < 0) throw ApiError.badRequest('amount inválido');
    patch.amount = n;
  }

  if (data.dueDate !== undefined) {
    const d = new Date(data.dueDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('dueDate inválida');
    patch.dueDate = d;
  }

  if (data.status !== undefined) {
    if (!STATUSES.includes(data.status)) {
      throw ApiError.badRequest(`status deve ser um de: ${STATUSES.join(', ')}`);
    }
    patch.status = data.status;
  }

  if (data.paidAt !== undefined) {
    if (data.paidAt === null) {
      patch.paidAt = null;
    } else {
      const p = new Date(data.paidAt);
      if (Number.isNaN(p.getTime())) throw ApiError.badRequest('paidAt inválido');
      patch.paidAt = p;
    }
  }

  if (data.competence !== undefined) {
    patch.competence = assertCompetence(data.competence);
  }

  if (data.description !== undefined) {
    patch.description = String(data.description);
  }

  const existing = await Invoice.findOne({ _id: id, tenantId });
  if (!existing) throw ApiError.notFound('Cobrança não encontrada');

  if (Object.keys(patch).length === 0) {
    return exports.getById(tenantId, id);
  }

  if (data.status === 'paid') {
    if (data.paidAt === undefined && patch.paidAt === undefined && !existing.paidAt) {
      patch.paidAt = new Date();
    }
  } else if (data.status !== undefined && data.status !== 'paid') {
    if (data.paidAt === undefined) patch.paidAt = null;
  }

  let updated;
  try {
    updated = await Invoice.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: patch },
      { new: true },
    )
      .populate('clientId', 'fullName phone email')
      .populate('planId', 'name speedMbps price');
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(
        'Já existe cobrança para esta combinação de cliente e competência.',
        INVOICE_DUPLICATE_CODE,
      );
    }
    throw err;
  }

  if (!updated) throw ApiError.notFound('Cobrança não encontrada');

  return updated;
};

exports.remove = async (tenantId, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('ID inválido');

  const deleted = await Invoice.findOneAndDelete({ _id: id, tenantId });
  if (!deleted) throw ApiError.notFound('Cobrança não encontrada');

  return true;
};

/**
 * Gera cobranças pendentes do mês para clientes ativos (uma por cliente/competência).
 * Não cria duplicata se já existir invoice (tenantId + clientId + competence).
 */
exports.generateMonth = async (tenantId, data) => {
  const competenceVal = assertCompetence(data?.competence);

  const clients = await Client.find({ tenantId, status: 'active' }).lean();

  const existingRows = await Invoice.find({ tenantId, competence: competenceVal })
    .select('clientId')
    .lean();
  const duplicateClientIds = new Set(existingRows.map((row) => String(row.clientId)));

  const warnings = [];
  let createdCount = 0;
  let skippedDuplicateCount = 0;
  let skippedOtherCount = 0;

  for (const client of clients) {
    const clientIdStr = String(client._id);

    if (duplicateClientIds.has(clientIdStr)) {
      skippedDuplicateCount += 1;
      continue;
    }

    if (!client.planId || !mongoose.Types.ObjectId.isValid(String(client.planId))) {
      skippedOtherCount += 1;
      warnings.push(`Cliente "${client.fullName || clientIdStr}": planId inválido ou ausente.`);
      continue;
    }

    const plan = await Plan.findOne({ _id: client.planId, tenantId });
    if (!plan) {
      skippedOtherCount += 1;
      warnings.push(`Cliente "${client.fullName || clientIdStr}": plano não encontrado neste tenant.`);
      continue;
    }

    const amount = Number(client.monthlyPrice);
    if (Number.isNaN(amount) || amount < 0) {
      skippedOtherCount += 1;
      warnings.push(`Cliente "${client.fullName || clientIdStr}": monthlyPrice inválido.`);
      continue;
    }

    const dueDay = client.dueDay !== undefined && client.dueDay !== null ? Number(client.dueDay) : 10;
    if (dueDay < 1 || dueDay > 28) {
      skippedOtherCount += 1;
      warnings.push(`Cliente "${client.fullName || clientIdStr}": dueDay deve estar entre 1 e 28.`);
      continue;
    }

    const [y, mo] = competenceVal.split('-');
    const dueDate = new Date(`${y}-${mo}-${String(dueDay).padStart(2, '0')}T12:00:00.000Z`);
    if (Number.isNaN(dueDate.getTime())) {
      skippedOtherCount += 1;
      warnings.push(`Cliente "${client.fullName || clientIdStr}": não foi possível calcular a data de vencimento.`);
      continue;
    }

    const description = `Mensalidade competência ${competenceVal}`;

    try {
      await Invoice.create({
        tenantId,
        clientId: client._id,
        planId: client.planId,
        amount,
        dueDate,
        status: 'pending',
        paidAt: null,
        competence: competenceVal,
        description,
      });
      createdCount += 1;
      duplicateClientIds.add(clientIdStr);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        skippedDuplicateCount += 1;
        duplicateClientIds.add(clientIdStr);
        continue;
      }
      throw err;
    }
  }

  return {
    competence: competenceVal,
    eligibleCount: clients.length,
    createdCount,
    skippedDuplicateCount,
    skippedOtherCount,
    warnings,
  };
};

/**
 * Diagnóstico operacional da política financeira (somente leitura).
 * Não altera status de cliente, não enfileira jobs.
 */
exports.financePolicyImpact = async (tenantId, query = {}) => {
  const tid = new mongoose.Types.ObjectId(tenantId);
  const now = new Date();
  const limit = Math.min(500, Math.max(20, Number(query.limit) || 200));

  const tenant = await Tenant.findOne({ _id: tid }).select('slug financePolicy').lean();
  if (!tenant) throw ApiError.notFound('Tenant não encontrado');
  const policy = normalizeFinancePolicy(tenant);
  const canCutoffNow = withinCutoffWindow(policy, now);

  const overdueAgg = await Invoice.aggregate([
    { $match: { tenantId: tid, status: 'overdue' } },
    {
      $group: {
        _id: '$clientId',
        overdueCount: { $sum: 1 },
        oldestDueDate: { $min: '$dueDate' },
      },
    },
  ]);

  const overdueClientIds = overdueAgg.map((r) => r._id);
  const clientsOverdue = overdueClientIds.length
    ? await Client.find({ tenantId: tid, _id: { $in: overdueClientIds } })
        .select('_id fullName status financeAutomation')
        .lean()
    : [];
  const clientMap = new Map(clientsOverdue.map((c) => [String(c._id), c]));

  const overdueItems = overdueAgg.map((row) => {
    const cid = String(row._id);
    const c = clientMap.get(cid);
    const clientStatus = c ? c.status : 'unknown';
    const maxDaysLate = daysLate(now, row.oldestDueDate instanceof Date ? row.oldestDueDate : new Date(row.oldestDueDate));
    const inGrace = maxDaysLate < policy.financeGraceDays;
    const meetsInvoiceCount = row.overdueCount >= policy.financeMinOverdueInvoices;
    const meetsGraceDays = maxDaysLate >= policy.financeGraceDays;
    const protectedStatus = PROTECTED_CLIENT_STATUSES.includes(clientStatus);
    const blockedByCutoffWindow =
      policy.financeAutomationEnabled &&
      meetsInvoiceCount &&
      meetsGraceDays &&
      policy.financeCutoffWindowEnabled &&
      !canCutoffNow;
    const eligibleForDelinquent =
      policy.financeAutomationEnabled &&
      meetsInvoiceCount &&
      meetsGraceDays &&
      canCutoffNow &&
      !protectedStatus;

    let diagnosis = 'Sem ação';
    if (!policy.financeAutomationEnabled) diagnosis = 'Automação financeira desativada';
    else if (protectedStatus) diagnosis = `Status protegido (${clientStatus})`;
    else if (!meetsInvoiceCount) diagnosis = 'Abaixo do mínimo de faturas overdue';
    else if (inGrace) diagnosis = 'Em carência';
    else if (blockedByCutoffWindow) diagnosis = 'Fora da janela de corte';
    else if (eligibleForDelinquent && clientStatus === 'delinquent') diagnosis = 'Já está delinquent';
    else if (eligibleForDelinquent) diagnosis = 'Elegível para delinquent';

    const antiFlap = antiFlapSnapshot(now, policy, c && c.financeAutomation);
    if (
      antiFlap.inHoldWindow &&
      policy.financeAutomationEnabled &&
      eligibleForDelinquent &&
      clientStatus !== 'delinquent'
    ) {
      diagnosis = `${diagnosis} · Anti-flap: aguardar estabilização (~${Math.ceil((antiFlap.remainingMs || 0) / 60_000)} min)`;
    }

    return {
      clientId: cid,
      clientName: c && c.fullName ? String(c.fullName) : cid,
      clientStatus,
      overdueCount: row.overdueCount,
      maxDaysLate,
      inGrace,
      blockedByCutoffWindow,
      protectedStatus,
      eligibleForDelinquent,
      wouldReactivateWhenClear: false,
      antiFlap,
      diagnosis,
    };
  });

  const delinquentNoOverdue = await Client.find({
    tenantId: tid,
    status: 'delinquent',
    _id: { $nin: overdueClientIds },
  })
    .select('_id fullName status financeAutomation')
    .lean();

  const clearItems = delinquentNoOverdue.map((c) => {
    const wouldReactivateWhenClear = policy.financeAutomationEnabled && policy.financeAutoReactivateWhenClear;
    let diagnosis = wouldReactivateWhenClear
      ? 'Sem overdue: seria reativado pela política'
      : 'Sem overdue: auto-reativação desativada';
    const antiFlap = antiFlapSnapshot(now, policy, c && c.financeAutomation);
    if (antiFlap.inHoldWindow && wouldReactivateWhenClear) {
      diagnosis = `${diagnosis} · Anti-flap: aguardar estabilização (~${Math.ceil((antiFlap.remainingMs || 0) / 60_000)} min)`;
    }
    return {
      clientId: String(c._id),
      clientName: c.fullName || String(c._id),
      clientStatus: 'delinquent',
      overdueCount: 0,
      maxDaysLate: 0,
      inGrace: false,
      blockedByCutoffWindow: false,
      protectedStatus: false,
      eligibleForDelinquent: false,
      wouldReactivateWhenClear,
      antiFlap,
      diagnosis,
    };
  });

  const items = [...overdueItems, ...clearItems]
    .sort((a, b) => b.maxDaysLate - a.maxDaysLate || b.overdueCount - a.overdueCount || a.clientName.localeCompare(b.clientName))
    .slice(0, limit);

  const totalDelinquent = await Client.countDocuments({ tenantId: tid, status: 'delinquent' });

  return {
    tenant: {
      id: String(tid),
      slug: tenant.slug || '',
    },
    now: now.toISOString(),
    policy,
    evaluation: {
      cutoffWindowActiveNow: canCutoffNow,
      limit,
    },
    totals: {
      withOverdue: overdueItems.length,
      inGrace: overdueItems.filter((i) => i.inGrace).length,
      eligibleForDelinquent: overdueItems.filter((i) => i.eligibleForDelinquent).length,
      blockedByCutoffWindow: overdueItems.filter((i) => i.blockedByCutoffWindow).length,
      protectedStatus: overdueItems.filter((i) => i.protectedStatus).length,
      totalDelinquent,
      wouldReactivateWhenClear: clearItems.filter((i) => i.wouldReactivateWhenClear).length,
      impactItems: overdueItems.length + clearItems.length,
    },
    items,
  };
};
