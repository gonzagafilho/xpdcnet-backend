/**
 * Worker de sync MikroTik: simulação, dry-run ou execução live (RouterOS via adapter).
 *
 * Execução: npm run worker:sync  |  node src/workers/mikrotikSyncWorker.js
 * (requer MONGO_URI no ambiente, como o API server)
 *
 * Modo de execução (MIKROTIK_SYNC_EXECUTION_MODE):
 * - simulate (default): comportamento legado — sem RouterOS
 * - dry-run: validações + intent; SyncResult sem abrir socket
 * - live: applySyncIntent (liga ao equipamento)
 *
 * Variáveis opcionais:
 * - MIKROTIK_SYNC_POLL_MS (default 5000)
 * - MIKROTIK_SYNC_BATCH (default 10)
 * - MIKROTIK_SYNC_SIM_DELAY_MS (default 50) — só simulate
 * - MIKROTIK_SYNC_SIMULATE_FAILURE=1 — só simulate
 * - MIKROTIK_SYNC_REQUEUE=0 — desliga requeue em falha
 * - MIKROTIK_SYNC_MAX_ATTEMPTS (default 5)
 * - MIKROTIK_SYNC_STUCK_MS / MIKROTIK_SYNC_STUCK_BATCH — recuperação processing antigo
 * - MIKROTIK_SYNC_ROUTEROS_TIMEOUT_MS (default 20000) — timeout live (adapter)
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const mikrotikSyncService = require('../services/mikrotikSyncService');
const { pickExpectedSnapshot } = require('../services/mikrotikSyncAudit');
const Client = require('../models/Client');
const { scrubSecretsFromMessage } = require('../integrations/mikrotik/mikrotikClient');
const { applySyncIntent, dryRunApplySyncIntent } = require('../integrations/mikrotik/mikrotikAdapter');

const LOG_PREFIX = '[xpdcnet-sync-worker]';

const POLL_MS = Math.max(500, Number(process.env.MIKROTIK_SYNC_POLL_MS) || 5000);
const BATCH = Math.min(100, Math.max(1, Number(process.env.MIKROTIK_SYNC_BATCH) || 10));
const SIM_DELAY_MS = Math.min(5000, Math.max(0, Number(process.env.MIKROTIK_SYNC_SIM_DELAY_MS) || 50));
const SIM_FAIL =
  process.env.MIKROTIK_SYNC_SIMULATE_FAILURE === '1' || process.env.MIKROTIK_SYNC_SIMULATE_FAILURE === 'true';
const REQUEUE = process.env.MIKROTIK_SYNC_REQUEUE !== '0';
const MAX_ATT = Math.max(1, Number(process.env.MIKROTIK_SYNC_MAX_ATTEMPTS) || 5);
const ROUTEROS_TIMEOUT_MS = Math.min(
  120_000,
  Math.max(3_000, Number(process.env.MIKROTIK_SYNC_ROUTEROS_TIMEOUT_MS) || 20_000),
);

const STUCK_RAW = String(process.env.MIKROTIK_SYNC_STUCK_MS || '').trim();
const STUCK_DISABLED = ['0', '', 'false', 'off'].includes(STUCK_RAW.toLowerCase());
const STUCK_MS =
  !STUCK_DISABLED && STUCK_RAW !== ''
    ? Math.max(1, Number(process.env.MIKROTIK_SYNC_STUCK_MS) || 0)
    : 0;
const STUCK_BATCH = Math.min(100, Math.max(1, Number(process.env.MIKROTIK_SYNC_STUCK_BATCH) || 10));

/**
 * @returns {'simulate'|'dry-run'|null}
 */
function normalizeExecutionMode() {
  const raw = String(process.env.MIKROTIK_SYNC_EXECUTION_MODE || 'simulate')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (raw === 'simulate' || raw === 'dry-run' || raw === 'live') return raw;
  if (raw === 'dryrun') return 'dry-run';
  return null;
}

const EXECUTION_MODE = normalizeExecutionMode();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Permite sair em até ~step ms após SIGINT/SIGTERM em vez de esperar POLL_MS completo. */
async function sleepWhileRunning(ms, getRunning, step = 250) {
  let left = ms;
  while (left > 0 && getRunning()) {
    const chunk = Math.min(step, left);
    await sleep(chunk);
    left -= chunk;
  }
}

/**
 * @param {object} job
 * @returns {{ ok: true } | { error: string }}
 */
function validateIntentSnapshot(job) {
  const snap = job && job.intentSnapshot;
  if (!snap || typeof snap !== 'object') {
    return { error: 'intentSnapshot ausente ou inválido no job.' };
  }
  const goal = snap.recommendedSyncGoal;
  if (goal == null || String(goal).trim() === '') {
    return { error: 'intentSnapshot sem recommendedSyncGoal.' };
  }
  return { ok: true };
}

/**
 * Comportamento legado — sem RouterOS.
 * @param {object} job — documento lean do MikrotikSyncJob
 */
async function simulateRouterExecution(job) {
  const goal = job.intentSnapshot?.recommendedSyncGoal ?? 'n/a';
  const access = job.intentSnapshot?.effectiveAccess ?? 'n/a';
  console.log(
    `${LOG_PREFIX} mode=simulate step=simular job=%s tenant=%s client=%s server=%s goal=%s access=%s`,
    job._id,
    job.tenantId,
    job.clientId,
    job.serverId,
    goal,
    access,
  );

  if (SIM_FAIL) {
    throw new Error('Simulação: falha forçada (MIKROTIK_SYNC_SIMULATE_FAILURE)');
  }

  if (SIM_DELAY_MS > 0) {
    await sleep(SIM_DELAY_MS);
  }
}

/**
 * @param {string} executionMode
 * @param {object} syncResult
 * @param {object} job
 */
function logSyncOutcome(executionMode, syncResult, job) {
  const jid = String(job._id);
  const tid = String(job.tenantId);
  const cid = String(job.clientId);
  console.log(
    `${LOG_PREFIX} mode=%s job=%s tenant=%s client=%s success=%s action=%s msg=%s%s`,
    executionMode,
    jid,
    tid,
    cid,
    syncResult.success,
    syncResult.action,
    truncateLog(syncResult.message, 180),
    syncResult.error ? ` errCode=${truncateLog(syncResult.error, 80)}` : '',
  );
}

function truncateLog(s, max) {
  const t = s != null ? String(s) : '';
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * @param {object} job
 * @param {'dry-run'|'live'} executionMode
 * @returns {Promise<{ success: boolean, action: string, message: string, error?: string }>}
 */
async function runIntentExecution(job, executionMode) {
  const tid = String(job.tenantId);

  const v = validateIntentSnapshot(job);
  if ('error' in v) {
    return { success: false, action: 'update', message: v.error, error: 'INVALID_INTENT_SNAPSHOT' };
  }

  const client = await Client.findOne({ _id: job.clientId, tenantId: tid }).lean();
  if (!client) {
    return {
      success: false,
      action: 'update',
      message: 'Cliente não encontrado para este tenant — sync abortada.',
      error: 'CLIENT_NOT_FOUND',
    };
  }

  const ctx = { tenantId: tid, client, timeoutMs: ROUTEROS_TIMEOUT_MS, syncJobId: job._id };

  if (executionMode === 'dry-run') {
    return dryRunApplySyncIntent(job.intentSnapshot, ctx);
  }

  return applySyncIntent(job.intentSnapshot, ctx);
}

/**
 * @param {object} job
 */
async function processJob(job) {
  const tid = String(job.tenantId);
  const jid = String(job._id);

  const claimed = await mikrotikSyncService.markProcessing(tid, jid);
  if (!claimed) {
    console.log(`${LOG_PREFIX} ignorar job=%s (já não está pending — idempotência / corrida)`, jid);
    return;
  }

  try {
    if (EXECUTION_MODE === 'simulate') {
      await simulateRouterExecution(job);
      const done = await mikrotikSyncService.markDone(tid, jid, {
        executionMode: 'simulate',
        executionAction: 'simulate',
        executionMessage: 'Simulação concluída (sem RouterOS).',
        executionError: '',
        executedAt: new Date(),
        expectedSnapshot: pickExpectedSnapshot(job.intentSnapshot),
      });
      if (done) {
        console.log(
          `${LOG_PREFIX} mode=simulate markDone job=%s tenant=%s client=%s`,
          jid,
          tid,
          job.clientId,
        );
      } else {
        console.warn(`${LOG_PREFIX} mode=simulate markDone não aplicado job=%s (esperado processing)`, jid);
      }
      return;
    }

    const syncResult = await runIntentExecution(job, EXECUTION_MODE);
    logSyncOutcome(EXECUTION_MODE, syncResult, job);

    if (syncResult.success) {
      const done = await mikrotikSyncService.markDone(tid, jid, {
        executionMode: EXECUTION_MODE,
        executionAction: syncResult.action,
        executionMessage: syncResult.message,
        executionError: syncResult.error || '',
        executedAt: new Date(),
        expectedSnapshot: pickExpectedSnapshot(job.intentSnapshot),
      });
      if (done) {
        console.log(
          `${LOG_PREFIX} mode=%s markDone job=%s tenant=%s client=%s action=%s`,
          EXECUTION_MODE,
          jid,
          tid,
          job.clientId,
          syncResult.action,
        );
      } else {
        console.warn(
          `${LOG_PREFIX} mode=%s markDone não aplicado job=%s (esperado processing)`,
          EXECUTION_MODE,
          jid,
        );
      }
      return;
    }

    const failMsg = syncResult.error ? `${syncResult.message} [${syncResult.error}]` : syncResult.message;
    const after = await mikrotikSyncService.markFailed(tid, jid, failMsg, {
      requeue: REQUEUE,
      maxAttempts: MAX_ATT,
      audit: {
        executionMode: EXECUTION_MODE,
        executionAction: syncResult.action,
        executionMessage: syncResult.message,
        executionError: syncResult.error || '',
        executedAt: new Date(),
        expectedSnapshot: pickExpectedSnapshot(job.intentSnapshot),
      },
    });
    if (after) {
      console.log(
        `${LOG_PREFIX} mode=%s markFailed job=%s tenant=%s client=%s status=%s attempts=%s`,
        EXECUTION_MODE,
        jid,
        tid,
        job.clientId,
        after.status,
        after.attempts,
      );
    } else {
      console.warn(`${LOG_PREFIX} mode=%s markFailed não aplicado job=%s`, EXECUTION_MODE, jid);
    }
  } catch (err) {
    const raw = err && err.message ? err.message : String(err);
    const msg = scrubSecretsFromMessage(String(raw));
    console.error(
      `${LOG_PREFIX} mode=%s excepção job=%s tenant=%s client=%s: %s`,
      EXECUTION_MODE,
      jid,
      tid,
      job.clientId,
      msg,
    );
    const after = await mikrotikSyncService.markFailed(tid, jid, msg, {
      requeue: REQUEUE,
      maxAttempts: MAX_ATT,
      audit: {
        executionMode: EXECUTION_MODE,
        executionAction: 'update',
        executionMessage: msg,
        executionError: 'EXCEPTION',
        executedAt: new Date(),
        expectedSnapshot: pickExpectedSnapshot(job.intentSnapshot),
      },
    });
    if (after) {
      console.log(
        `${LOG_PREFIX} mode=%s markFailed job=%s status=%s attempts=%s`,
        EXECUTION_MODE,
        jid,
        after.status,
        after.attempts,
      );
    }
  }
}

async function tick() {
  if (STUCK_MS > 0) {
    try {
      const { reclaimed } = await mikrotikSyncService.reclaimStuckProcessingGlobal(STUCK_MS, STUCK_BATCH);
      if (reclaimed > 0) {
        console.log(`${LOG_PREFIX} reclaim stuck: %d job(s) processing → pending`, reclaimed);
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} reclaim stuck falhou: %s`, e && e.message ? e.message : e);
    }
  }

  const jobs = await mikrotikSyncService.getPendingJobsGlobal(BATCH);
  if (jobs.length === 0) {
    return;
  }
  console.log(`${LOG_PREFIX} mode=%s %d job(s) pending neste lote`, EXECUTION_MODE, jobs.length);
  for (const job of jobs) {
    await processJob(job);
  }
}

async function main() {
  try {
    if (!EXECUTION_MODE) {
      console.error(
        `${LOG_PREFIX} MIKROTIK_SYNC_EXECUTION_MODE inválido: use simulate | dry-run | live (recebido: %s)`,
        String(process.env.MIKROTIK_SYNC_EXECUTION_MODE || '(vazio)'),
      );
      return 1;
    }

    const ok = await connectDB();
    if (!ok) {
      console.error(`${LOG_PREFIX} MongoDB indisponível — worker não inicia`);
      return 1;
    }

    const encryptionService = require('../services/encryptionService');
    await encryptionService.hydrateMikrotikSecretFromDatabase();

    console.log(
      `${LOG_PREFIX} loop iniciado mode=%s poll=%dms batch=%d routerosTimeoutMs=%d stuckMs=%s stuckBatch=%d simFail=%s (só simulate) requeue=%s maxAttempts=%d`,
      EXECUTION_MODE,
      POLL_MS,
      BATCH,
      ROUTEROS_TIMEOUT_MS,
      STUCK_MS > 0 ? String(STUCK_MS) : 'off',
      STUCK_BATCH,
      SIM_FAIL,
      REQUEUE,
      MAX_ATT,
    );

    let running = true;
    const stop = () => {
      running = false;
      console.log(`${LOG_PREFIX} paragem pedida (SIGINT/SIGTERM) — a terminar após tick/sleep curto`);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    while (running) {
      try {
        await tick();
      } catch (e) {
        console.error(`${LOG_PREFIX} erro no tick: %s`, e && e.message ? e.message : e);
      }
      if (!running) break;
      await sleepWhileRunning(POLL_MS, () => running);
    }

    return 0;
  } catch (err) {
    console.error(`${LOG_PREFIX} erro fatal no main: %s`, err && err.message ? err.message : err);
    return 1;
  } finally {
    console.log(`${LOG_PREFIX} mongoose.disconnect() (shutdown limpo)`);
    await mongoose.disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((err) => {
      console.error(`${LOG_PREFIX} promise rejeitada: %s`, err && err.message ? err.message : err);
      process.exit(1);
    });
}
