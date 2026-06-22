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
    tenantId: payload.tenantId || null,
    serverId: payload.serverId,
    serverName: payload.serverName || '',
    cpuPercent: payload.cpuPercent ?? 0,
    memoryPercent: payload.memoryPercent ?? 0,
    memoryFreeBytes: payload.memoryFreeBytes ?? null,
    memoryTotalBytes: payload.memoryTotalBytes ?? null,
    temperature: payload.temperature ?? null,
    voltage: payload.voltage ?? null,
    version: payload.version || '',
    uptime: payload.uptime || '',
    boardName: payload.boardName || '',
    cpuCount: payload.cpuCount ?? null,
    architectureName: payload.architectureName || '',
    interfaceTotal: payload.interfaceTotal ?? (Array.isArray(payload.interfaces) ? payload.interfaces.length : 0),
    interfaceRunning: payload.interfaceRunning ?? (Array.isArray(payload.interfaces)
      ? payload.interfaces.filter((item) => item.running && !item.disabled).length
      : 0),
    pppOnline: payload.pppOnline ?? 0,
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
