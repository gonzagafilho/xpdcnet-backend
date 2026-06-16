/**
 * Worker dedicado: enfileira MikrotikSyncJob quando trustRelease expira (delinquent + until vencido).
 * Não abre RouterOS; não substitui o worker principal de sync.
 *
 * Execução: npm run worker:trust-expiry-enqueue | node src/workers/mikrotikTrustExpiryEnqueueWorker.js
 *
 * Variáveis:
 * - MIKROTIK_TRUST_EXPIRY_POLL_MS (default 300000 = 5 min)
 * - MIKROTIK_TRUST_EXPIRY_BATCH (default 40, cap 200 no serviço)
 */

require('dotenv').config();

const { markWorkerHeartbeat } = require('../services/workerTelemetryService');

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { runTrustExpiryEnqueueTick, LOG_PREFIX } = require('../services/mikrotikTrustExpiryEnqueueService');

const POLL_MS = Math.max(60_000, Number(process.env.MIKROTIK_TRUST_EXPIRY_POLL_MS) || 300_000);
const BATCH = Math.min(200, Math.max(1, Number(process.env.MIKROTIK_TRUST_EXPIRY_BATCH) || 40));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepWhileRunning(ms, getRunning, step = 250) {
  let left = ms;
  while (left > 0 && getRunning()) {
    const chunk = Math.min(step, left);
    await sleep(chunk);
    left -= chunk;
  }
}

async function tick() {
  await runTrustExpiryEnqueueTick({ batchLimit: BATCH });
}

async function main() {
  try {
    const ok = await connectDB();
    if (!ok) {
      console.error(`${LOG_PREFIX} MongoDB indisponível — worker não inicia`);
      return 1;
    }

    console.log(
      `${LOG_PREFIX} loop iniciado poll=%dms batch=%d (só enqueue; sem RouterOS)`,
      POLL_MS,
      BATCH,
    );

    let running = true;
    const stop = () => {
      running = false;
      console.log(`${LOG_PREFIX} paragem pedida (SIGINT/SIGTERM)`);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    while (running) {
      const startedAt = Date.now();

      try {
        await tick();

          await markWorkerHeartbeat('trust', {
            success: true,
            status: 'online',
            lastDurationMs: Date.now() - startedAt,
          });
      } catch (e) {
        console.error(`${LOG_PREFIX} erro no tick: %s`, e && e.message ? e.message : e);

          await markWorkerHeartbeat('trust', {
            status: 'degraded',
            errorMessage: e && e.message ? e.message : String(e),
            lastDurationMs: Date.now() - startedAt,
          });
      }
      if (!running) break;
      await sleepWhileRunning(POLL_MS, () => running);
    }

    return 0;
  } catch (err) {
    console.error(`${LOG_PREFIX} erro fatal: %s`, err && err.message ? err.message : err);
    return 1;
  } finally {
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
