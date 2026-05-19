/**
 * Worker: consolidação financeira (invoice pending→overdue; Client active|pending→delinquent; delinquent→active).
 * Desacoplado da API HTTP.
 *
 * Execução: npm run worker:finance-rollup | node src/workers/financeDelinquencyRollupWorker.js
 *
 * Variáveis:
 * - FINANCE_ROLLUP_POLL_MS (default 300000 = 5 min)
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { runFinanceRollupGlobal, LOG_PREFIX } = require('../services/financeDelinquencyRollupService');

const POLL_MS = Math.max(60_000, Number(process.env.FINANCE_ROLLUP_POLL_MS) || 300_000);

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
  await runFinanceRollupGlobal();
}

async function main() {
  try {
    const ok = await connectDB();
    if (!ok) {
      console.error(`${LOG_PREFIX} MongoDB indisponível — worker não inicia`);
      return 1;
    }

    console.log(`${LOG_PREFIX} loop iniciado poll=%dms (financeiro → status → enqueue)`, POLL_MS);

    let running = true;
    const stop = () => {
      running = false;
      console.log(`${LOG_PREFIX} paragem pedida (SIGINT/SIGTERM)`);
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
