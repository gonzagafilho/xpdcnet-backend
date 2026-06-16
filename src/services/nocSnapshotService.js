const NocSnapshot = require('../models/NocSnapshot');

const RETENTION_LIMIT = Math.max(
  100,
  Number(process.env.NOC_SNAPSHOT_RETENTION_LIMIT || 2000),
);

async function saveNocSnapshot(payload = {}) {
  const doc = await NocSnapshot.create({
    pending: payload?.queue?.pending ?? 0,
    processing: payload?.queue?.processing ?? 0,
    failed: payload?.queue?.failed ?? 0,
    stale: payload?.queue?.stale ?? 0,
    pressurePercent: payload?.queue?.pressurePercent ?? 0,
    throughputPerMinute: payload?.throughputPerMinute ?? 0,
    agents: payload?.agents || {},
    workers: payload?.workers || {},
  });

  const extra = await NocSnapshot.countDocuments();
  if (extra > RETENTION_LIMIT) {
    const oldRows = await NocSnapshot.find({})
      .sort({ createdAt: -1 })
      .skip(RETENTION_LIMIT)
      .select('_id')
      .lean();

    if (oldRows.length) {
      await NocSnapshot.deleteMany({
        _id: { $in: oldRows.map((r) => r._id) },
      });
    }
  }

  return doc;
}

async function listRecentNocSnapshots(limit = 60) {
  return NocSnapshot.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 60)))
    .lean();
}

module.exports = {
  saveNocSnapshot,
  listRecentNocSnapshots,
};
