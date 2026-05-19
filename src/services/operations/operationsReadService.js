const mongoose = require('mongoose');
const ApiError = require('../../errors/ApiError');
const Client = require('../../models/Client');
const Invoice = require('../../models/Invoice');
const MikrotikSyncJob = require('../../models/MikrotikSyncJob');
const invoiceService = require('../invoiceService');
const mikrotikMonitoringService = require('../mikrotikMonitoringService');

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfTodayLocal() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function toPercent(done, failed) {
  const base = done + failed;
  if (base <= 0) return 100;
  return Math.round((done / base) * 1000) / 10;
}

exports.getExecutiveDashboard = async (tenantId) => {
  const impact = await invoiceService.financePolicyImpact(tenantId, { limit: 500 });
  const divergence = await mikrotikMonitoringService.getFinancePolicyDivergenceDashboard(tenantId, {
    limit: 500,
    onlyDivergent: 0,
    timeoutMs: 6000,
    concurrency: 4,
  });

  const start = startOfTodayLocal();
  const end = endOfTodayLocal();

  const syncTodayAgg = await MikrotikSyncJob.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        'audit.executedAt': { $gte: start, $lte: end },
        status: { $in: ['done', 'failed'] },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  let doneToday = 0;
  let failedToday = 0;
  for (const row of syncTodayAgg) {
    if (row._id === 'done') doneToday = row.count;
    if (row._id === 'failed') failedToday = row.count;
  }

  const failingJobsToday = await MikrotikSyncJob.find({
    tenantId,
    status: 'failed',
    'audit.executedAt': { $gte: start, $lte: end },
  })
    .sort({ 'audit.executedAt': -1 })
    .limit(15)
    .populate('clientId', 'fullName')
    .lean();

  return {
    now: new Date().toISOString(),
    tenant: impact.tenant,
    executive: {
      willBlockToday: impact.items.filter(
        (x) => x.eligibleForDelinquent && x.clientStatus !== 'delinquent',
      ).length,
      inGrace: impact.totals.inGrace,
      alreadyBlocked: impact.totals.totalDelinquent,
      protected: impact.totals.protectedStatus,
      divergent: divergence.totals.divergent,
      failedExecutionsToday: failedToday,
      operationalSuccessRate: toPercent(doneToday, failedToday),
      doneExecutionsToday: doneToday,
    },
    details: {
      policyImpactTotals: impact.totals,
      divergenceTotals: divergence.totals,
      failedJobsToday: (failingJobsToday || []).map((j) => ({
        id: String(j._id),
        clientId: j.clientId && typeof j.clientId === 'object' ? String(j.clientId._id) : String(j.clientId),
        clientName:
          j.clientId && typeof j.clientId === 'object' && j.clientId.fullName
            ? String(j.clientId.fullName)
            : '—',
        attempts: j.attempts || 0,
        lastError: j.lastError || '',
        executedAt: j.audit && j.audit.executedAt ? j.audit.executedAt : null,
      })),
    },
  };
};

function pushEvent(events, evt) {
  if (!evt || !evt.at || !evt.type) return;
  events.push(evt);
}

exports.getClientTimeline = async (tenantId, clientId) => {
  if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
    throw ApiError.badRequest('clientId inválido');
  }

  const client = await Client.findOne({ _id: clientId, tenantId })
    .select('_id fullName status trustRelease mikrotik dueDay')
    .lean();
  if (!client) throw ApiError.notFound('Cliente não encontrado');

  const [invoices, jobs, impact] = await Promise.all([
    Invoice.find({ tenantId, clientId })
      .select('_id competence amount dueDate status paidAt createdAt updatedAt')
      .sort({ createdAt: 1 })
      .lean(),
    MikrotikSyncJob.find({ tenantId, clientId })
      .sort({ createdAt: 1 })
      .select(
        '_id status triggerReason triggerSource triggerContext attempts lastError createdAt updatedAt audit intentSnapshot',
      )
      .lean(),
    invoiceService.financePolicyImpact(tenantId, { limit: 500 }),
  ]);

  const impactItem = (impact.items || []).find((x) => String(x.clientId) === String(clientId)) || null;
  const policy = impact.policy;
  const now = new Date();
  const events = [];

  for (const inv of invoices) {
    pushEvent(events, {
      at: inv.createdAt,
      type: 'INVOICE_CREATED',
      title: 'Fatura criada',
      detail: `Competência ${inv.competence} · valor ${Number(inv.amount || 0).toFixed(2)}`,
    });

    if (inv.dueDate) {
      pushEvent(events, {
        at: inv.dueDate,
        type: 'INVOICE_DUE',
        title: 'Fatura vencida',
        detail: `Competência ${inv.competence}`,
      });

      if (typeof policy.financeGraceDays === 'number' && policy.financeGraceDays > 0) {
        const graceAt = new Date(new Date(inv.dueDate).getTime() + policy.financeGraceDays * 86_400_000);
        pushEvent(events, {
          at: graceAt,
          type: 'ENTERED_GRACE',
          title: 'Entrou em carência',
          detail: `Carência de ${policy.financeGraceDays} dia(s)`,
        });
      }
    }

    if (inv.status === 'paid' && inv.paidAt) {
      pushEvent(events, {
        at: inv.paidAt,
        type: 'PAYMENT_IDENTIFIED',
        title: 'Pagamento identificado',
        detail: `Competência ${inv.competence}`,
      });
    }
  }

  if (impactItem && impactItem.eligibleForDelinquent) {
    pushEvent(events, {
      at: now,
      type: 'ELIGIBLE_BLOCK',
      title: 'Elegível para bloqueio',
      detail: impactItem.diagnosis || 'Regra financeira atendida',
    });
  }

  for (const job of jobs) {
    pushEvent(events, {
      at: job.createdAt,
      type: 'QUEUE_CREATED',
      title: 'Fila gerada',
      detail: `${job.triggerReason || 'TRIGGER'} · status inicial ${job.status}`,
    });

    if (job.audit && job.audit.executedAt) {
      pushEvent(events, {
        at: job.audit.executedAt,
        type: 'WORKER_EXECUTED',
        title: 'Worker executou',
        detail: `${job.audit.executionMode || 'mode?'} · ${job.audit.executionAction || 'action?'} · ${job.status}`,
      });
    }

    if (job.status === 'done') {
      pushEvent(events, {
        at: job.audit && job.audit.executedAt ? job.audit.executedAt : job.updatedAt,
        type: 'MIKROTIK_CONFIRMED',
        title: 'MikroTik confirmou',
        detail: job.audit && job.audit.executionMessage ? job.audit.executionMessage : 'Sync concluída',
      });
    }

    const action =
      job.triggerContext && typeof job.triggerContext === 'object' ? job.triggerContext.action : null;

    if (action === 'restore_active') {
      pushEvent(events, {
        at: job.createdAt,
        type: 'ELIGIBLE_REACTIVATE',
        title: 'Elegível para reativação',
        detail: 'Sem overdue e política permite auto-reativação',
      });

      if (job.status === 'done') {
        pushEvent(events, {
          at: job.audit && job.audit.executedAt ? job.audit.executedAt : job.updatedAt,
          type: 'REACTIVATION_EXECUTED',
          title: 'Reativação executada',
          detail: 'Worker concluiu retorno para acesso ativo',
        });
      }
    }
  }

  const sorted = events
    .filter((e) => e && e.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((e) => ({ ...e, at: new Date(e.at).toISOString() }));

  return {
    now: new Date().toISOString(),
    client: {
      id: String(client._id),
      fullName: client.fullName || String(client._id),
      status: client.status,
    },
    snapshot: {
      financeDiagnosis: impactItem ? impactItem.diagnosis : 'Sem diagnóstico específico',
      eligibleForDelinquent: impactItem ? Boolean(impactItem.eligibleForDelinquent) : false,
      wouldReactivateWhenClear: impactItem ? Boolean(impactItem.wouldReactivateWhenClear) : false,
      syncState: client.mikrotik && client.mikrotik.sync ? client.mikrotik.sync.state || 'never' : 'never',
    },
    totals: {
      invoices: invoices.length,
      jobs: jobs.length,
      events: sorted.length,
    },
    events: sorted,
  };
};
