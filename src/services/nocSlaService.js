const NocIncident = require('../models/NocIncident');
const NocSlaSnapshot = require('../models/NocSlaSnapshot');

async function generateSlaSnapshot() {
  const now = Date.now();

  const since24h = new Date(now - 24 * 60 * 60 * 1000);

  const [
    degraded24h,
    critical24h,
    openIncidents,
    resolvedIncidents,
  ] = await Promise.all([
    NocIncident.countDocuments({
      createdAt: { $gte: since24h },
      severity: { $in: ['warning', 'critical'] },
      status: { $ne: 'resolved' },
    }),

    NocIncident.countDocuments({
      createdAt: { $gte: since24h },
      severity: 'critical',
      status: { $ne: 'resolved' },
    }),

    NocIncident.countDocuments({
      status: 'open',
    }),

    NocIncident.find({
      status: 'resolved',
      resolvedAt: { $ne: null },
    })
      .sort({ resolvedAt: -1 })
      .limit(100)
      .lean(),
  ]);

  let mttrMinutes = 0;

  if (resolvedIncidents.length > 0) {
    const total = resolvedIncidents.reduce((acc, row) => {
      const start = row.startedAt
        ? new Date(row.startedAt).getTime()
        : 0;

      const end = row.resolvedAt
        ? new Date(row.resolvedAt).getTime()
        : 0;

      if (!start || !end) return acc;

      return acc + (end - start);
    }, 0);

    mttrMinutes = Math.round(
      total / resolvedIncidents.length / 1000 / 60,
    );
  }

  const uptimePercent24h = Math.max(
    0,
    Math.min(
      100,
      Number((100 - degraded24h * 0.15).toFixed(2)),
    ),
  );

  const mtbfMinutes =
    degraded24h > 0
      ? Math.round((24 * 60) / degraded24h)
      : 24 * 60;

  const availability =
    critical24h > 0
      ? 'critical'
      : degraded24h > 0
        ? 'degraded'
        : 'healthy';

  return NocSlaSnapshot.create({
    uptimePercent24h,
    degradedEvents24h: degraded24h,
    criticalIncidents24h: critical24h,
    openIncidents,
    mttrMinutes,
    mtbfMinutes,
    availability,
    metadata: {
      generatedAt: new Date().toISOString(),
    },
  });
}

async function getLatestSlaSnapshot() {
  return NocSlaSnapshot.findOne({})
    .sort({ createdAt: -1 })
    .lean();
}

module.exports = {
  generateSlaSnapshot,
  getLatestSlaSnapshot,
};
