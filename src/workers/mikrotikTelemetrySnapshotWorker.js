require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const MikrotikServer = require('../models/MikrotikServer');
const mikrotikServerMonitoringService = require('../services/mikrotikServerMonitoringService');

const LOG = '[mikrotikTelemetrySnapshotWorker]';

const INTERVAL_MS = Math.max(
  30000,
  Number(process.env.MIKROTIK_TELEMETRY_SNAPSHOT_POLL_MS || 60000)
);

const TIMEOUT_MS = Math.min(
  120000,
  Math.max(5000, Number(process.env.MIKROTIK_TELEMETRY_SNAPSHOT_TIMEOUT_MS || 20000))
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return true;

  const ok = await connectDB();
  if (!ok) {
    throw new Error('MongoDB não conectado');
  }

  return true;
}

async function runOnce() {
  await connectMongo();

  const tenantIds = await MikrotikServer.distinct('tenantId', {
    isActive: true,
  });

  let tenantsChecked = 0;
  let serversChecked = 0;
  let onlineServers = 0;
  let offlineServers = 0;

  for (const tenantId of tenantIds) {
    try {
      const payload = await mikrotikServerMonitoringService.listServersWithMonitoring(
        String(tenantId),
        { timeoutMs: TIMEOUT_MS }
      );

      tenantsChecked += 1;
      serversChecked += Number(payload?.summary?.totalServers || 0);
      onlineServers += Number(payload?.summary?.onlineServers || 0);
      offlineServers += Number(payload?.summary?.offlineServers || 0);
    } catch (err) {
      console.error(`${LOG} erro tenant=${tenantId}:`, err && err.message ? err.message : err);
    }
  }

  console.log(
    `${LOG} tenants=${tenantsChecked}/${tenantIds.length} servers=${serversChecked} online=${onlineServers} offline=${offlineServers} intervalMs=${INTERVAL_MS}`
  );
}

async function main() {
  console.log(`${LOG} iniciado interval=${INTERVAL_MS} timeout=${TIMEOUT_MS}`);

  while (true) {
    try {
      await runOnce();
    } catch (err) {
      console.error(`${LOG} erro geral:`, err && err.message ? err.message : err);
    }

    await sleep(INTERVAL_MS);
  }
}

main();
