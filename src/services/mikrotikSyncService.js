const mongoose = require('mongoose');
const Client = require('../models/Client');
const MikrotikSyncJob = require('../models/MikrotikSyncJob');
const clientNetworkPolicyService = require('./clientNetworkPolicyService');
const { normalizeAuditPayload } = require('./mikrotikSyncAudit');
const { normalizeTriggerPayload } = require('./mikrotikSyncTriggerCatalog');

const MAX_LAST_ERROR_LEN = 2000;

/**
 * Fila de sync: persistência e estados. Não abre socket, não usa API RouterOS.
 */

function trimErr(msg) {
  const s = msg != null ? String(msg) : '';
  return s.length > MAX_LAST_ERROR_LEN ? s.slice(0, MAX_LAST_ERROR_LEN) : s;
}

/**
 * @param {string} tenantId
 * @param {string|mongoose.Types.ObjectId} clientId
 * @param {object} [options]
 * @param {boolean} [options.force] - se true, ignora idempotência (útil para testes internos)
 * @param {string} [options.triggerReason]
 * @param {string} [options.triggerSource]
 * @param {object} [options.triggerContext]
 * @param {boolean} [options.refreshIntentOnDuplicate] — com job aberto: actualiza intentSnapshot/serverId (ex.: trust expirou)
 * @returns {Promise<object|null>}
 */
exports.enqueueSync = async (tenantId, clientId, options = {}) => {
  // Compatibilidade segura:
  // formato oficial: enqueueSync(tenantId, clientId, options)
  // formato legado/teste: enqueueSync({ tenantId, clientId, reason, ... })
  if (
    tenantId &&
    typeof tenantId === 'object' &&
    !Array.isArray(tenantId) &&
    clientId === undefined
  ) {
    const legacy = tenantId;
    tenantId = legacy.tenantId;
    clientId = legacy.clientId;
    options = {
      force: legacy.force === true,
      triggerReason: legacy.triggerReason || legacy.reason || 'legacy_enqueue_object',
      triggerSource: legacy.triggerSource || 'legacy_enqueue_object',
      triggerContext: legacy.triggerContext || legacy.context || {},
      refreshIntentOnDuplicate: legacy.refreshIntentOnDuplicate === true,
    };
  }

  const tid = tenantId;
  const cid = clientId;
  const trigger = normalizeTriggerPayload(options);
  if (!mongoose.Types.ObjectId.isValid(String(cid))) return null;

  const client = await Client.findOne({ _id: cid, tenantId: tid });
  if (!client) return null;

  const serverId = client.mikrotik?.serverId || null;

  if (!serverId) {
    await Client.updateOne(
      { _id: cid, tenantId: tid },
      {
        $set: {
          'mikrotik.sync.state': 'skipped',
          'mikrotik.sync.lastAttemptAt': new Date(),
          'mikrotik.sync.lastErrorMessage':
            'Sem mikrotik.serverId no cliente — job de sync não enfileirado.',
        },
      },
    );
    return { skipped: true, reason: 'no_server_id' };
  }

  if (!options.force) {
    const openJob = await MikrotikSyncJob.findOne({
      tenantId: tid,
      clientId: cid,
      status: { $in: ['pending', 'processing'] },
    }).lean();
    if (openJob) {
      const setFields = {};

      // Regra: preserva motivo/origem do primeiro enqueue; agrega contexto recente de forma segura.
      if (trigger.triggerReason || trigger.triggerSource || trigger.triggerContext) {
        const mergedContext = {
          ...(openJob.triggerContext && typeof openJob.triggerContext === 'object' ? openJob.triggerContext : {}),
          ...(trigger.triggerContext && typeof trigger.triggerContext === 'object' ? trigger.triggerContext : {}),
          lastSeenTrigger: {
            reason: trigger.triggerReason,
            source: trigger.triggerSource,
            at: new Date().toISOString(),
          },
        };
        const reasons = Array.isArray(mergedContext.reasons) ? mergedContext.reasons : [];
        if (trigger.triggerReason && !reasons.includes(trigger.triggerReason)) {
          mergedContext.reasons = [...reasons, trigger.triggerReason].slice(0, 10);
        }
        setFields.triggerContext = mergedContext;
      }

      if (options.refreshIntentOnDuplicate) {
        const clientFresh = await Client.findOne({ _id: cid, tenantId: tid });
        if (clientFresh) {
          setFields.intentSnapshot = clientNetworkPolicyService.resolveNetworkIntent(clientFresh);
          setFields.serverId = clientFresh.mikrotik?.serverId || null;
        }
      }

      if (Object.keys(setFields).length > 0) {
        await MikrotikSyncJob.updateOne({ _id: openJob._id, tenantId: tid }, { $set: setFields });
      }
      const fresh = await MikrotikSyncJob.findOne({ _id: openJob._id, tenantId: tid }).lean();
      return { job: fresh || openJob, duplicate: true };
    }
  }

  const intent = clientNetworkPolicyService.resolveNetworkIntent(client);

  const job = await MikrotikSyncJob.create({
    tenantId: tid,
    clientId: cid,
    serverId,
    intentSnapshot: intent,
    triggerReason: trigger.triggerReason,
    triggerSource: trigger.triggerSource,
    triggerContext: trigger.triggerContext,
    status: 'pending',
    attempts: 0,
    lastError: '',
  });

  await Client.updateOne(
    { _id: cid, tenantId: tid },
    {
      $set: {
        'mikrotik.sync.state': 'pending',
        'mikrotik.sync.lastAttemptAt': new Date(),
        'mikrotik.sync.lastErrorMessage': '',
      },
    },
  );

  return { job, duplicate: false };
};

/**
 * @param {string} tenantId
 * @param {number} [limit]
 */
exports.getPendingJobs = async (tenantId, limit = 50) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return MikrotikSyncJob.find({ tenantId, status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(lim)
    .lean();
};

/** Todas as tenants — para o worker de sync (multi-tenant). */
exports.getPendingJobsGlobal = async (limit = 50) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return MikrotikSyncJob.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(lim)
    .lean();
};

/**
 * @param {string} tenantId
 * @param {string} jobId
 */
exports.markProcessing = async (tenantId, jobId) => {
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) return null;
  return MikrotikSyncJob.findOneAndUpdate(
    { _id: jobId, tenantId, status: 'pending' },
    { $set: { status: 'processing', lastError: '' } },
    { new: true },
  ).lean();
};

/**
 * @param {string} tenantId
 * @param {string} jobId
 * @param {object|null} [auditPayload] — normalizado e persistido em `audit` (worker)
 */
exports.markDone = async (tenantId, jobId, auditPayload = null) => {
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) return null;
  const setDoc = { status: 'done', lastError: '' };
  if (auditPayload && typeof auditPayload === 'object') {
    setDoc.audit = normalizeAuditPayload(auditPayload);
  }
  const job = await MikrotikSyncJob.findOneAndUpdate(
    { _id: jobId, tenantId, status: 'processing' },
    { $set: setDoc },
    { new: true },
  ).lean();

  if (!job) return null;

  const now = new Date();
  await Client.updateOne(
    { _id: job.clientId, tenantId },
    {
      $set: {
        'mikrotik.sync.state': 'in_sync',
        'mikrotik.sync.lastAttemptAt': now,
        'mikrotik.sync.lastSuccessAt': now,
        'mikrotik.sync.lastErrorMessage': '',
      },
    },
  );

  return job;
};

/**
 * @param {string} tenantId
 * @param {string} jobId
 * @param {string} message
 * @param {object} [opts]
 * @param {boolean} [opts.requeue] - se true e attempts < maxAttempts, volta a pending para retry
 * @param {number} [opts.maxAttempts]
 * @param {object} [opts.audit] — resultado operacional (worker)
 */
exports.markFailed = async (tenantId, jobId, message, opts = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) return null;
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 5);
  const err = trimErr(message);

  const current = await MikrotikSyncJob.findOne({ _id: jobId, tenantId, status: 'processing' }).lean();
  if (!current) return null;

  const nextAttempts = (current.attempts || 0) + 1;
  let nextStatus = 'failed';
  if (opts.requeue && nextAttempts < maxAttempts) {
    nextStatus = 'pending';
  }

  const setFields = { status: nextStatus, attempts: nextAttempts, lastError: err };
  if (opts.audit && typeof opts.audit === 'object') {
    setFields.audit = normalizeAuditPayload(opts.audit);
  }

  await MikrotikSyncJob.updateOne(
    { _id: jobId, tenantId },
    { $set: setFields },
  );

  const now = new Date();
  await Client.updateOne(
    { _id: current.clientId, tenantId },
    {
      $set: {
        'mikrotik.sync.state': nextStatus === 'pending' ? 'pending' : 'error',
        'mikrotik.sync.lastAttemptAt': now,
        'mikrotik.sync.lastErrorMessage': err,
      },
    },
  );

  return MikrotikSyncJob.findOne({ _id: jobId, tenantId }).lean();
};

/** Mínimo 10 min quando uso activo — evita requeue durante sync longo só com `updatedAt`. */
const STUCK_PROCESSING_MIN_MS = 10 * 60 * 1000;

/**
 * Reverte jobs em `processing` há demasiado tempo para `pending` (opt-in no worker via env).
 * Compares `updatedAt` no documento (última escrita no job; após markProcessing não muda até done/failed).
 * Condicional atómico por `_id`+`tenantId`+`status`+`updatedAt` evita corrida entre workers.
 *
 * @param {number} maxAgeMs — idade mínima; valores abaixo de STUCK_PROCESSING_MIN_MS são elevados ao mínimo
 * @param {number} [limit]
 * @returns {Promise<{ reclaimed: number }>}
 */
exports.reclaimStuckProcessingGlobal = async (maxAgeMs, limit = 10) => {
  const age = Math.max(Number(maxAgeMs) || 0, STUCK_PROCESSING_MIN_MS);
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const cutoff = new Date(Date.now() - age);
  const candidates = await MikrotikSyncJob.find({
    status: 'processing',
    updatedAt: { $lt: cutoff },
  })
    .sort({ updatedAt: 1 })
    .limit(lim)
    .lean();

  const msg = trimErr(
    'Requeued: processing timeout (worker recovery; sem execução RouterOS nesta fase).',
  );

  let reclaimed = 0;
  for (const j of candidates) {
    const r = await MikrotikSyncJob.updateOne(
      {
        _id: j._id,
        tenantId: j.tenantId,
        status: 'processing',
        updatedAt: j.updatedAt,
      },
      { $set: { status: 'pending', lastError: msg }, $unset: { audit: 1 } },
    );
    if (r.modifiedCount !== 1) continue;

    reclaimed += 1;
    await Client.updateOne(
      { _id: j.clientId, tenantId: j.tenantId },
      {
        $set: {
          'mikrotik.sync.state': 'pending',
          'mikrotik.sync.lastAttemptAt': new Date(),
          'mikrotik.sync.lastErrorMessage': msg,
        },
      },
    );
  }

  return { reclaimed };
};

const JOB_STATUSES = ['pending', 'processing', 'done', 'failed'];

/**
 * Lista jobs da fila para o tenant (painel operacional).
 * @param {string} tenantId
 * @param {object} query — status, clientId, serverId, page, limit
 */
exports.listJobsForTenant = async (tenantId, query = {}) => {
  const tid = tenantId;
  const filter = { tenantId: tid };

  const st = query.status;
  if (st != null && String(st).trim() !== '') {
    if (!JOB_STATUSES.includes(String(st))) {
      return { error: 'invalid_status' };
    }
    filter.status = String(st);
  }

  const cid = query.clientId;
  if (cid != null && String(cid).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(cid))) {
      return { error: 'invalid_clientId' };
    }
    filter.clientId = cid;
  }

  const sid = query.serverId;
  if (sid != null && String(sid).trim() !== '') {
    if (!mongoose.Types.ObjectId.isValid(String(sid))) {
      return { error: 'invalid_serverId' };
    }
    filter.serverId = sid;
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    MikrotikSyncJob.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('clientId', 'fullName')
      .populate('tenantId', 'name slug')
      .lean(),
    MikrotikSyncJob.countDocuments(filter),
  ]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return { items, total, page, limit, pages };
};

/**
 * Contagens por estado para o tenant.
 * @param {string} tenantId
 */
exports.getSummaryForTenant = async (tenantId) => {
  const tid = tenantId;
  const [pending, processing, done, failed] = await Promise.all([
    MikrotikSyncJob.countDocuments({ tenantId: tid, status: 'pending' }),
    MikrotikSyncJob.countDocuments({ tenantId: tid, status: 'processing' }),
    MikrotikSyncJob.countDocuments({ tenantId: tid, status: 'done' }),
    MikrotikSyncJob.countDocuments({ tenantId: tid, status: 'failed' }),
  ]);
  return { pending, processing, done, failed };
};

/**
 * Reencaminha job falhado para a fila (pending). Não altera resolveNetworkIntent.
 * @param {string} tenantId
 * @param {string} jobId
 * @returns {Promise<{ job?: object, error?: string }>}
 */
exports.retryFailedJobForTenant = async (tenantId, jobId) => {
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) {
    return { error: 'invalid_id' };
  }
  const tid = tenantId;

  const existing = await MikrotikSyncJob.findOne({ _id: jobId, tenantId: tid }).lean();
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'failed') return { error: 'not_failed' };

  const openOther = await MikrotikSyncJob.findOne({
    tenantId: tid,
    clientId: existing.clientId,
    status: { $in: ['pending', 'processing'] },
    _id: { $ne: existing._id },
  }).lean();
  if (openOther) return { error: 'conflict_open' };

  const r = await MikrotikSyncJob.updateOne(
    { _id: jobId, tenantId: tid, status: 'failed' },
    { $set: { status: 'pending', lastError: '', attempts: 0 }, $unset: { audit: 1 } },
  );
  if (r.modifiedCount !== 1) return { error: 'not_failed' };

  const now = new Date();
  await Client.updateOne(
    { _id: existing.clientId, tenantId: tid },
    {
      $set: {
        'mikrotik.sync.state': 'pending',
        'mikrotik.sync.lastAttemptAt': now,
        'mikrotik.sync.lastErrorMessage': '',
      },
    },
  );

  const job = await MikrotikSyncJob.findOne({ _id: jobId, tenantId: tid })
    .populate('clientId', 'fullName')
    .populate('tenantId', 'name slug')
    .lean();
  return { job };
};
