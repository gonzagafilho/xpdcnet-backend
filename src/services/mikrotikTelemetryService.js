const MikrotikTelemetrySnapshot = require('../models/MikrotikTelemetrySnapshot');

function calculateHealth({
  cpuPercent = 0,
  memoryPercent = 0,
}) {
  if (cpuPercent >= 90 || memoryPercent >= 95) {
    return 'critical';
  }

  if (cpuPercent >= 70 || memoryPercent >= 80) {
    return 'warning';
  }

  return 'healthy';
}

async function saveTelemetrySnapshot(payload = {}) {
  const health = calculateHealth(payload);

  return MikrotikTelemetrySnapshot.create({
    serverId: payload.serverId,
    serverName: payload.serverName || '',
    cpuPercent: payload.cpuPercent || 0,
    memoryPercent: payload.memoryPercent || 0,
    temperature: payload.temperature || 0,
    pppOnline: payload.pppOnline || 0,
    interfaces: payload.interfaces || [],
    metadata: payload.metadata || {},
    health,
  });
}

async function listLatestTelemetry(limit = 20) {
  return MikrotikTelemetrySnapshot.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = {
  saveTelemetrySnapshot,
  listLatestTelemetry,
  calculateHealth,
};
