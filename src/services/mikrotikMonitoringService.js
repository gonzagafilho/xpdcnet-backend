const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const MikrotikServer = require('../models/MikrotikServer');
const MikrotikSyncJob = require('../models/MikrotikSyncJob');
const clientNetworkPolicyService = require('./clientNetworkPolicyService');
const invoiceService = require('./invoiceService');
const mikrotikSyncService = require('./mikrotikSyncService');
const { TRIGGER_REASONS } = require('./mikrotikSyncTriggerCatalog');
const { withMikrotikConnection, scrubSecretsFromMessage } = require('../integrations/mikrotik/mikrotikClient');
const executor = require('../integrations/mikrotik/mikrotikExecutor');
const { decrypt } = require('./encryptionService');
const networkNodeRoutingService = require('./networkNodeRoutingService');
const remoteAgentCommandService = require('./remoteAgentCommandService');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');

const DEFAULT_TIMEOUT_MS = 20_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Aguarda conclusão de MONITORING_INSPECT enfileirado para o agente remoto. */
async function waitRemoteMonitoringResult(commandId, timeoutMs) {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 5_000), 120_000);
  while (Date.now() < deadline) {
    const doc = await RemoteAgentCommand.findById(commandId).lean();
    if (!doc) return { queryError: 'REMOTE_COMMAND_LOST' };
    if (doc.status === 'done' && doc.resultSuccess) {
      try {
        const parsed = JSON.parse(doc.resultMessage || '{}');
        if (parsed.actual && typeof parsed.actual === 'object') return parsed.actual;
        return { queryError: 'REMOTE_INSPECT_PARSE' };
      } catch (_) {
        return { queryError: 'REMOTE_INSPECT_PARSE' };
      }
    }
    if (doc.status === 'failed') {
      const err =
        doc.resultError && String(doc.resultError).trim()
          ? String(doc.resultError).trim()
          : doc.resultMessage && String(doc.resultMessage).trim()
            ? String(doc.resultMessage).trim()
            : 'REMOTE_INSPECT_FAILED';
      return { queryError: err };
    }
    await sleep(300);
  }
  return { queryError: 'REMOTE_INSPECT_TIMEOUT' };
}

/**
 * Expectativa de estado no equipamento derivada do intent (sem alterar resolveNetworkIntent).
 * @param {object} intent
 * @param {object} clientPlain
 * @returns {{ deviceStatus: 'active'|'blocked'|'missing'|null, profileHint: string|null }}
 */
function expectedDeviceFromIntent(intent, clientPlain) {
  const goal = intent && intent.recommendedSyncGoal;
  if (goal === 'noop' || goal === 'hold') {
    return { deviceStatus: null, profileHint: null };
  }
  const profileHint =
    clientPlain.mikrotik && clientPlain.mikrotik.profile != null && String(clientPlain.mikrotik.profile).trim()
      ? String(clientPlain.mikrotik.profile).trim()
      : 'default';
  if (goal === 'ensure_identity') {
    return { deviceStatus: 'active', profileHint };
  }
  if (goal === 'apply_block') {
    return { deviceStatus: 'blocked', profileHint: null };
  }
  if (goal === 'remove_identity') {
    return { deviceStatus: 'missing', profileHint: null };
  }
  return { deviceStatus: null, profileHint: null };
}

/**
 * @param {{ status: string, profile: string|null }} actual
 * @param {{ deviceStatus: string|null, profileHint: string|null }} expected
 * @param {string|null} queryError
 * @param {string|null} skipReason
 */
function computeDivergence(actual, expected, queryError, skipReason) {
  if (queryError) {
    return { divergent: null, divergenceReason: 'Consulta ao RouterOS falhou — não é possível comparar.' };
  }
  if (expected.deviceStatus == null) {
    return { divergent: false, divergenceReason: null };
  }

  if (skipReason === 'NO_MIKROTIK_SERVER' || skipReason === 'SERVER_NOT_AVAILABLE') {
    if (expected.deviceStatus === 'missing') {
      return { divergent: false, divergenceReason: null };
    }
    return {
      divergent: true,
      divergenceReason: 'Cadastro sem servidor MikroTik activo, mas a política prevê alteração no equipamento.',
    };
  }

  if (skipReason === 'NOT_PPPOE_OR_NO_USERNAME') {
    return {
      divergent: expected.deviceStatus !== null,
      divergenceReason:
        expected.deviceStatus !== null
          ? 'Cliente sem PPPoE ou sem utilizador — expectativa de equipamento não aplicável da mesma forma.'
          : null,
    };
  }

  if (actual.status !== expected.deviceStatus) {
    return {
      divergent: true,
      divergenceReason: `Esperado «${expected.deviceStatus}» (política); no equipamento «${actual.status}».`,
    };
  }

  if (
    expected.deviceStatus === 'active' &&
    expected.profileHint &&
    actual.profile &&
    expected.profileHint !== actual.profile
  ) {
    return {
      divergent: true,
      divergenceReason: `Perfil: cadastro «${expected.profileHint}», MikroTik «${actual.profile}».`,
    };
  }

  return { divergent: false, divergenceReason: null };
}

/**
 * GET lógico para painel: estado real PPPoE + intent + divergência.
 * @param {string} tenantId
 * @param {string} clientId
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 */
exports.getClientMikrotikMonitoring = async (tenantId, clientId, opts = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
    throw ApiError.badRequest('ID de cliente inválido');
  }
  const tid = tenantId;
  const cid = clientId;

  const client = await Client.findOne({ _id: cid, tenantId: tid }).lean();
  if (!client) throw ApiError.notFound('Cliente não encontrado');

  const intent = clientNetworkPolicyService.resolveNetworkIntent(client);
  const expected = expectedDeviceFromIntent(intent, client);

  const intentSummary = {
    recommendedSyncGoal: intent.recommendedSyncGoal != null ? String(intent.recommendedSyncGoal) : '',
    effectiveAccess: intent.effectiveAccess != null ? String(intent.effectiveAccess) : '',
  };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const emptyActual = {
    exists: false,
    disabled: false,
    profile: null,
    status: 'missing',
  };

  let actual = { ...emptyActual };
  let queryError = null;
  let skipReason = null;

  const pppUser =
    client.access && client.access.username != null ? String(client.access.username).trim() : '';
  const authType = client.access && client.access.authType != null ? String(client.access.authType) : 'pppoe';

  if (authType !== 'pppoe' || !pppUser) {
    skipReason = 'NOT_PPPOE_OR_NO_USERNAME';
    const div = computeDivergence(actual, expected, queryError, skipReason);
    return {
      ...actual,
      intent: intentSummary,
      expected,
      divergent: div.divergent,
      divergenceReason: div.divergenceReason,
      queryError,
      skipReason,
    };
  }

  const serverId = client.mikrotik && client.mikrotik.serverId ? client.mikrotik.serverId : null;
  if (!serverId || !mongoose.Types.ObjectId.isValid(String(serverId))) {
    skipReason = 'NO_MIKROTIK_SERVER';
    const div = computeDivergence(actual, expected, queryError, skipReason);
    return {
      ...actual,
      intent: intentSummary,
      expected,
      divergent: div.divergent,
      divergenceReason: div.divergenceReason,
      queryError,
      skipReason,
    };
  }

  const serverDoc = await MikrotikServer.findOne({ _id: serverId, tenantId: tid }).lean();
  if (!serverDoc || serverDoc.isActive === false) {
    skipReason = 'SERVER_NOT_AVAILABLE';
    const div = computeDivergence(actual, expected, queryError, skipReason);
    return {
      ...actual,
      intent: intentSummary,
      expected,
      divergent: div.divergent,
      divergenceReason: div.divergenceReason,
      queryError,
      skipReason,
    };
  }

  let serverPassword = '';
  try {
    serverPassword = decrypt(serverDoc.password != null ? String(serverDoc.password) : '');
  } catch (err) {
    queryError = 'Credencial do servidor MikroTik inválida ou não legível no ambiente actual.';
    actual = { ...emptyActual };
    const div = computeDivergence(actual, expected, queryError, skipReason);
    return {
      exists: actual.exists,
      disabled: actual.disabled,
      profile: actual.profile,
      status: actual.status,
      intent: intentSummary,
      expected,
      divergent: div.divergent,
      divergenceReason: div.divergenceReason,
      queryError,
      skipReason,
    };
  }

  const serverLike = {
    host: serverDoc.host,
    port: serverDoc.port,
    username: serverDoc.username,
    password: serverPassword,
  };

  const route = await networkNodeRoutingService.resolveExecutionRoute(tid, client, serverDoc);
  if (route.channel === 'ERROR') {
    queryError = route.message || route.code || 'NETWORK_ROUTE_ERROR';
    actual = { ...emptyActual };
    const div = computeDivergence(actual, expected, queryError, skipReason);
    return {
      exists: actual.exists,
      disabled: actual.disabled,
      profile: actual.profile,
      status: actual.status,
      intent: intentSummary,
      expected,
      divergent: div.divergent,
      divergenceReason: div.divergenceReason,
      queryError,
      skipReason,
      executionChannel: 'ERROR',
    };
  }

  if (route.channel === 'REMOTE_AGENT') {
    try {
      const payload = {
        kind: 'MONITORING_INSPECT',
        pppUsername: pppUser,
        routerApi: {
          host: serverLike.host,
          port: serverLike.port,
          username: serverLike.username,
          password: serverLike.password,
        },
      };
      const { command } = await remoteAgentCommandService.enqueueMonitoringInspectCommand({
        tenantId: tid,
        networkNodeId: route.networkNode._id,
        clientId: client._id,
        serverId: serverDoc._id,
        payload,
      });
      const remoteRes = await waitRemoteMonitoringResult(command._id, timeoutMs);
      if (remoteRes.queryError) {
        queryError = scrubSecretsFromMessage(remoteRes.queryError);
        actual = { ...emptyActual };
      } else {
        actual = remoteRes;
      }
    } catch (err) {
      queryError = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
      actual = { ...emptyActual };
    }
    const div = computeDivergence(actual, expected, queryError, skipReason);
    return {
      exists: actual.exists,
      disabled: actual.disabled,
      profile: actual.profile,
      status: actual.status,
      intent: intentSummary,
      expected,
      divergent: div.divergent,
      divergenceReason: div.divergenceReason,
      queryError,
      skipReason,
      executionChannel: 'REMOTE_AGENT',
      networkNodeId: String(route.networkNode._id),
    };
  }

  try {
    actual = await withMikrotikConnection(serverLike, { timeoutMs }, async (api) =>
      executor.inspectPppSecretByName(api, pppUser),
    );
  } catch (err) {
    queryError = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
    actual = { ...emptyActual };
  }

  const div = computeDivergence(actual, expected, queryError, skipReason);
  return {
    exists: actual.exists,
    disabled: actual.disabled,
    profile: actual.profile,
    status: actual.status,
    intent: intentSummary,
    expected,
    divergent: div.divergent,
    divergenceReason: div.divergenceReason,
    queryError,
    skipReason,
    executionChannel: 'LOCAL_DIRECT',
  };
};

async function mapWithConcurrency(items, concurrency, worker) {
  const out = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      out[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}

function divergenceLabel(divergent) {
  if (divergent === true) return 'divergent';
  if (divergent === false) return 'in_sync';
  return 'unknown';
}

/**
 * Diagnóstico agregado de divergência (somente leitura).
 * Reusa financePolicyImpact + monitoramento por cliente, sem alterar pipeline.
 *
 * @param {string} tenantId
 * @param {object} [query]
 */
exports.getFinancePolicyDivergenceDashboard = async (tenantId, query = {}) => {
  const limit = Math.min(500, Math.max(10, Number(query.limit) || 50));
  const timeoutMs = Math.min(120_000, Math.max(3_000, Number(query.timeoutMs) || 8_000));
  const onlyDivergent = String(query.onlyDivergent || '').trim() === '1';
  const concurrency = Math.min(8, Math.max(1, Number(query.concurrency) || 4));

  const impact = await invoiceService.financePolicyImpact(tenantId, { limit });
  const clientIds = impact.items
    .map((i) => String(i.clientId))
    .filter((v) => mongoose.Types.ObjectId.isValid(v))
    .map((v) => new mongoose.Types.ObjectId(v));

  const [clients, latestJobs] = await Promise.all([
    Client.find({ tenantId, _id: { $in: clientIds } })
      .select('_id mikrotik.sync')
      .lean(),
    MikrotikSyncJob.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), clientId: { $in: clientIds } } },
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          _id: '$clientId',
          status: { $first: '$status' },
          attempts: { $first: '$attempts' },
          updatedAt: { $first: '$updatedAt' },
          audit: { $first: '$audit' },
        },
      },
    ]),
  ]);

  const clientMap = new Map(clients.map((c) => [String(c._id), c]));
  const latestJobMap = new Map(latestJobs.map((j) => [String(j._id), j]));

  const rows = await mapWithConcurrency(impact.items, concurrency, async (item) => {
    const monitoring = await exports.getClientMikrotikMonitoring(tenantId, item.clientId, { timeoutMs });
    const cid = String(item.clientId);
    const c = clientMap.get(cid);
    const job = latestJobMap.get(cid);
    const sync = c && c.mikrotik && c.mikrotik.sync ? c.mikrotik.sync : {};

    return {
      clientId: cid,
      clientName: item.clientName,
      financialState: {
        clientStatus: item.clientStatus,
        overdueCount: item.overdueCount,
        maxDaysLate: item.maxDaysLate,
        inGrace: item.inGrace,
      },
      policyDecision: {
        diagnosis: item.diagnosis,
        eligibleForDelinquent: item.eligibleForDelinquent,
        wouldReactivateWhenClear: item.wouldReactivateWhenClear,
      },
      desiredNetworkState: {
        recommendedSyncGoal: monitoring.intent.recommendedSyncGoal,
        effectiveAccess: monitoring.intent.effectiveAccess,
        expectedDeviceStatus: monitoring.expected.deviceStatus,
        expectedProfileHint: monitoring.expected.profileHint,
      },
      realNetworkState: {
        status: monitoring.status,
        exists: monitoring.exists,
        disabled: monitoring.disabled,
        profile: monitoring.profile,
        queryError: monitoring.queryError,
        skipReason: monitoring.skipReason || null,
      },
      divergence: {
        status: divergenceLabel(monitoring.divergent),
        divergent: monitoring.divergent,
        reason: monitoring.divergenceReason,
      },
      lastExecution: {
        syncState: sync.state || 'never',
        lastAttemptAt: sync.lastAttemptAt || null,
        lastSuccessAt: sync.lastSuccessAt || null,
        lastErrorMessage: sync.lastErrorMessage || '',
        lastJobStatus: job ? job.status : null,
        lastJobAttempts: job ? job.attempts : null,
        lastJobUpdatedAt: job ? job.updatedAt : null,
        lastAudit: job && job.audit ? job.audit : null,
      },
    };
  });

  const filtered = onlyDivergent ? rows.filter((r) => r.divergence.divergent === true) : rows;
  const totals = {
    items: filtered.length,
    divergent: filtered.filter((r) => r.divergence.divergent === true).length,
    inSync: filtered.filter((r) => r.divergence.divergent === false).length,
    unknown: filtered.filter((r) => r.divergence.divergent == null).length,
    queryErrors: filtered.filter((r) => Boolean(r.realNetworkState.queryError)).length,
  };

  return {
    tenant: impact.tenant,
    now: new Date().toISOString(),
    policySnapshot: impact.policy,
    evaluation: {
      cutoffWindowActiveNow: impact.evaluation.cutoffWindowActiveNow,
      limit,
      timeoutMs,
      onlyDivergent,
      concurrency,
    },
    totals,
    items: filtered,
  };
};

const MAX_RECONCILE_REASON_LEN = 240;

/**
 * Reconciliação manual: re-enfileira sync oficial quando leitura confirma divergência real.
 * Não altera Client.status nem RouterOS aqui.
 *
 * @param {string} tenantId
 * @param {string} clientId
 * @param {object} opts
 * @param {object} [opts.user] req.user
 * @param {string} [opts.reason]
 * @param {boolean} [opts.force] repasse a enqueueSync (job pendente)
 * @param {number} [opts.timeoutMs]
 */
exports.reconcileClientDivergence = async (tenantId, clientId, opts = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
    throw ApiError.badRequest('ID de cliente inválido');
  }
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const reasonRaw = opts.reason != null ? String(opts.reason).trim() : '';
  const reason =
    reasonRaw.length > MAX_RECONCILE_REASON_LEN ? reasonRaw.slice(0, MAX_RECONCILE_REASON_LEN) : reasonRaw;
  const force = Boolean(opts.force);

  const monitoring = await exports.getClientMikrotikMonitoring(tenantId, clientId, { timeoutMs });

  if (monitoring.queryError) {
    throw ApiError.unprocessable(
      `Não é possível reconciliar com erro de consulta ao MikroTik: ${monitoring.queryError}`,
      'RECONCILE_QUERY_ERROR',
    );
  }
  if (monitoring.divergent !== true) {
    throw ApiError.conflict(
      monitoring.divergent == null
        ? 'Estado de divergência indeterminado — reconciliação manual não aplicável.'
        : 'Não há divergência relevante entre política e MikroTik; nada a enfileirar.',
      'RECONCILE_NOT_DIVERGENT',
    );
  }

  const desiredSnapshot = {
    recommendedSyncGoal: monitoring.intent && monitoring.intent.recommendedSyncGoal,
    effectiveAccess: monitoring.intent && monitoring.intent.effectiveAccess,
    expected: monitoring.expected,
  };
  const observedSnapshot = {
    status: monitoring.status,
    exists: monitoring.exists,
    disabled: monitoring.disabled,
    profile: monitoring.profile,
    skipReason: monitoring.skipReason || null,
  };

  const operator =
    opts.user && typeof opts.user === 'object'
      ? String(opts.user.email || opts.user.id || opts.user.sub || '').trim()
      : '';

  const triggerContext = {
    manualReconcile: true,
    operator: operator || '(desconhecido)',
    operatorReason: reason || null,
    requestedAt: new Date().toISOString(),
    desiredSnapshot,
    observedSnapshot,
    divergenceReason: monitoring.divergenceReason || null,
  };

  const enqueueResult = await mikrotikSyncService.enqueueSync(tenantId, clientId, {
    triggerReason: TRIGGER_REASONS.DIVERGENCE_MANUAL_RECONCILE,
    triggerSource: 'admin.mikrotik_monitoring.reconcile',
    triggerContext,
    force,
  });

  if (!enqueueResult) {
    throw ApiError.unprocessable('Enqueue não retornou resultado.', 'RECONCILE_ENQUEUE_FAILED');
  }
  if (enqueueResult.skipped && enqueueResult.reason === 'no_server_id') {
    throw ApiError.unprocessable(
      'Cliente sem mikrotik.serverId — sync não pode ser enfileirada. Corrija o cadastro antes de reconciliar.',
      'RECONCILE_NO_SERVER',
    );
  }

  return {
    ok: true,
    clientId: String(clientId),
    enqueued: !enqueueResult.skipped && !enqueueResult.duplicate,
    duplicate: Boolean(enqueueResult.duplicate),
    skipped: Boolean(enqueueResult.skipped),
    job: enqueueResult.job || null,
    triggerReason: TRIGGER_REASONS.DIVERGENCE_MANUAL_RECONCILE,
    monitoring: {
      divergent: monitoring.divergent,
      divergenceReason: monitoring.divergenceReason,
      skipReason: monitoring.skipReason || null,
    },
  };
};
