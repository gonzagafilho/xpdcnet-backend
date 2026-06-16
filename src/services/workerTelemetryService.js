const WorkerHeartbeat = require('../models/WorkerHeartbeat');

const WORKER_ONLINE_MS = Math.max(
  30_000,
  Number(process.env.WORKER_HEARTBEAT_ONLINE_MS || 180_000),
);

const WORKER_IDLE_MS = Math.max(
  Number(process.env.WORKER_HEARTBEAT_IDLE_MS || 900_000),
  WORKER_ONLINE_MS,
);

async function markWorkerHeartbeat(worker, payload = {}) {
  const now = new Date();

  const update = {
    $set: {
      worker,
      status: payload.status || 'online',
      lastSeenAt: now,
      lastDurationMs: Number(payload.lastDurationMs || 0),
      metadata: payload.metadata || {},
    },
    $inc: {
      tickCount: 1,
    },
  };

  if (payload.success) {
    update.$set.lastSuccessAt = now;
    update.$inc.successCount = 1;
  }

  if (payload.errorMessage) {
    update.$set.status = 'degraded';
    update.$set.lastErrorAt = now;
    update.$set.lastErrorMessage = String(payload.errorMessage).slice(0, 500);
    update.$inc.errorCount = 1;
  }

  return WorkerHeartbeat.findOneAndUpdate(
    { worker },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

async function getWorkerTelemetry() {
  const now = Date.now();
  const rows = await WorkerHeartbeat.find({
    worker: { $in: ['sync', 'finance', 'trust'] },
  }).lean();

  const byWorker = {};

  for (const name of ['sync', 'finance', 'trust']) {
    const row = rows.find((item) => item.worker === name);
    const lastSeenAt = row?.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
    const ageMs = lastSeenAt ? now - lastSeenAt : null;
    const online = ageMs !== null && ageMs <= WORKER_ONLINE_MS;

    byWorker[name] = {
      online,
      status: online ? row?.status || 'online' : 'offline',
      lastSeenAt: row?.lastSeenAt || null,
      ageMs,
      lastDurationMs: row?.lastDurationMs || 0,
      tickCount: row?.tickCount || 0,
      successCount: row?.successCount || 0,
      errorCount: row?.errorCount || 0,
      lastErrorAt: row?.lastErrorAt || null,
      lastErrorMessage: row?.lastErrorMessage || '',
    };
  }

  return byWorker;
}

module.exports = {
  WORKER_ONLINE_MS,
  WORKER_IDLE_MS,
  markWorkerHeartbeat,
  getWorkerTelemetry,
};
