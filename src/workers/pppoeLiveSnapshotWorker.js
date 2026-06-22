require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const {
  assertPppoeSnapshotIndexes,
  syncMikrotikPppoeSnapshotsForConcentrator,
} = require('../services/pppoeSnapshotService');

const LOG = '[pppoeLiveSnapshotWorker]';
const ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PPPOE_LIVE_SYNC_ENABLED || 'false').toLowerCase(),
);
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

function safeErrorMessage(err) {
  return String(err?.message || err || 'Erro desconhecido')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[redacted]')
    .replace(/senha\s*[:=]\s*\S+/gi, 'senha=[redacted]')
    .replace(/secret\s*[:=]\s*\S+/gi, 'secret=[redacted]')
    .slice(0, 500);
}

function statusFromError(message) {
  if (/auth|login|credential|permission|senha|password/i.test(message)) return 'auth_error';
  if (/timeout|timed out|etimedout|econnreset|econnrefused|unreachable/i.test(message)) return 'timeout';
  return 'offline';
}

async function runOnce() {
  await connectMongo();
  const concentrators = await NetworkConcentrator.find({
    enabled: true,
    protocol: 'routeros',
    type: 'mikrotik',
  })
    .select('+passwordEncrypted')
    .sort({ tenantId: 1, name: 1 })
    .lean();

  let totalOnline = 0;
  let totalOffline = 0;
  let totalSecrets = 0;
  let totalOfflineMarked = 0;
  let totalRead = 0;
  let concentratorsOk = 0;
  let concentratorsFailed = 0;

  for (const concentrator of concentrators) {
    const concentratorId = String(concentrator._id);
    const tenantId = String(concentrator.tenantId);
    try {
      const result = await syncMikrotikPppoeSnapshotsForConcentrator(concentrator);
      totalOnline += Number(result.online || 0);
      totalOffline += Number(result.offline || 0);
      totalSecrets += Number(result.totalSecrets || 0);
      totalOfflineMarked += Number(result.offlineMarked || 0);
      totalRead += Number(result.totalRead || 0);
      concentratorsOk += 1;

      await NetworkConcentrator.updateOne(
        { _id: concentrator._id, tenantId: concentrator.tenantId },
        { $set: { status: 'online', lastTestAt: new Date(), lastErrorSafe: '' } },
      ).catch(() => {});

      console.log(
        `${LOG} tenant=${tenantId} concentrator=${concentratorId} status=online online=${result.online} offline=${result.offline} secrets=${result.totalSecrets} offlineMarked=${result.offlineMarked} totalRead=${result.totalRead}`,
      );
    } catch (err) {
      const message = safeErrorMessage(err);
      const status = statusFromError(message);
      concentratorsFailed += 1;

      await NetworkConcentrator.updateOne(
        { _id: concentrator._id, tenantId: concentrator.tenantId },
        { $set: { status, lastTestAt: new Date(), lastErrorSafe: message } },
      ).catch(() => {});

      console.error(`${LOG} tenant=${tenantId} concentrator=${concentratorId} status=${status} error=${message}`);
    }
  }

  return {
    concentratorsTotal: concentrators.length,
    concentratorsOk,
    concentratorsFailed,
    online: totalOnline,
    offline: totalOffline,
    secrets: totalSecrets,
    offlineMarked: totalOfflineMarked,
    totalRead,
  };
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

  await connectMongo();
  await assertPppoeSnapshotIndexes();

  while (running) {
    const startedAt = Date.now();
    try {
      const result = await runOnce();
      console.log(
        `${LOG} cycle concentrators=${result.concentratorsOk}/${result.concentratorsTotal} failed=${result.concentratorsFailed} online=${result.online} offline=${result.offline} secrets=${result.secrets} offlineMarked=${result.offlineMarked} totalRead=${result.totalRead} durationMs=${Date.now() - startedAt}`,
      );
    } catch (err) {
      console.error(`${LOG} erro geral: ${safeErrorMessage(err)}`);
    }

    await sleepWhileRunning(INTERVAL_MS);
  }

  await mongoose.connection.close().catch(() => {});
  console.log(`${LOG} encerrado`);
}

main().catch(async (err) => {
  console.error(`${LOG} fatal: ${safeErrorMessage(err)}`);
  await mongoose.connection.close().catch(() => {});
  process.exitCode = 1;
});
