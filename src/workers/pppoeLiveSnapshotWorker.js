require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { syncMikrotikPppoeSnapshots } = require('../services/pppoeSnapshotService');

const LOG = '[pppoeLiveSnapshotWorker]';
const ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.PPPOE_LIVE_SYNC_ENABLED || 'true').toLowerCase());
const INTERVAL_MS = Math.max(5000, Number(process.env.PPPOE_LIVE_SYNC_INTERVAL_MS || 10000));

let running = true;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepWhileRunning(ms, step = 250) {
  let left = ms;
  while (running && left > 0) {
    const chunk = Math.min(step, left);
    await sleep(chunk);
    left -= chunk;
  }
}

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return true;
  const ok = await connectDB();
  if (!ok) throw new Error('MongoDB nao conectado');
  return true;
}

async function runOnce() {
  await connectMongo();
  return syncMikrotikPppoeSnapshots();
}

function requestStop(signal) {
  console.log(`${LOG} encerrando signal=${signal}`);
  running = false;
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

async function main() {
  console.log(`${LOG} iniciado enabled=${ENABLED} intervalMs=${INTERVAL_MS}`);
  if (!ENABLED) return;

  while (running) {
    const startedAt = Date.now();
    try {
      const result = await runOnce();
      console.log(
        `${LOG} ok online=${result.online} offlineMarked=${result.offlineMarked} totalRead=${result.totalRead} durationMs=${Date.now() - startedAt}`,
      );
    } catch (err) {
      console.error(`${LOG} erro:`, err && err.message ? err.message : 'Erro desconhecido');
    }

    await sleepWhileRunning(INTERVAL_MS);
  }

  await mongoose.connection.close().catch(() => {});
  console.log(`${LOG} encerrado`);
}

main();
