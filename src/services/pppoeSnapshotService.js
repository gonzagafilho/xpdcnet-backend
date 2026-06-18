const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');
const { getActivePppoeSessions } = require('./mikrotikRouterosService');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function trimSafe(value, max = 120) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaultTenantId() {
  return String(process.env.PPPOE_DEFAULT_TENANT_ID || 'default').trim() || 'default';
}

function calculateMbps(previous, currentBytes, previousKey, sampledAt) {
  if (!previous || previous[previousKey] == null || !previous.lastUpdateAt) return 0;
  const deltaBytes = numberValue(currentBytes) - numberValue(previous[previousKey]);
  if (deltaBytes <= 0) return 0;
  const seconds = Math.max((sampledAt.getTime() - new Date(previous.lastUpdateAt).getTime()) / 1000, 1);
  return Number(((deltaBytes * 8) / seconds / 1000000).toFixed(2));
}

async function upsertPppoeLiveSnapshot(snapshot = {}) {
  const tenantId = String(snapshot.tenantId || defaultTenantId()).trim();
  const pppoeUsername = normalizeUsername(snapshot.pppoeUsername || snapshot.username);
  if (!tenantId) throw new Error('tenantId ausente para snapshot PPPoE.');
  if (!pppoeUsername) throw new Error('pppoeUsername ausente para snapshot PPPoE.');

  const lastUpdateAt = snapshot.lastUpdateAt ? new Date(snapshot.lastUpdateAt) : new Date();
  const previous = await PppoeLiveSnapshot.findOne({ tenantId, pppoeUsername }).lean();
  const downloadBytes = numberValue(snapshot.downloadBytes);
  const uploadBytes = numberValue(snapshot.uploadBytes);
  const downloadMbps = snapshot.downloadMbps != null
    ? numberValue(snapshot.downloadMbps)
    : calculateMbps(previous, downloadBytes, 'downloadBytes', lastUpdateAt);
  const uploadMbps = snapshot.uploadMbps != null
    ? numberValue(snapshot.uploadMbps)
    : calculateMbps(previous, uploadBytes, 'uploadBytes', lastUpdateAt);

  return PppoeLiveSnapshot.findOneAndUpdate(
    { tenantId, pppoeUsername },
    {
      $set: {
        status: snapshot.status || 'online',
        currentIp: trimSafe(snapshot.currentIp, 80),
        uptime: trimSafe(snapshot.uptime, 80),
        service: trimSafe(snapshot.service, 80),
        callerId: trimSafe(snapshot.callerId, 160),
        downloadBytes,
        uploadBytes,
        downloadMbps,
        uploadMbps,
        pingMs: numberValue(snapshot.pingMs),
        jitterMs: numberValue(snapshot.jitterMs),
        packetLoss: numberValue(snapshot.packetLoss),
        source: snapshot.source || 'mikrotik',
        lastUpdateAt,
      },
      $setOnInsert: { tenantId, pppoeUsername },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

async function markMissingSessionsOffline(activeUsernames = [], tenantId = defaultTenantId()) {
  const active = activeUsernames.map(normalizeUsername).filter(Boolean);
  const now = new Date();
  const filter = {
    tenantId: String(tenantId),
    status: 'online',
  };
  if (active.length) filter.pppoeUsername = { $nin: active };

  const result = await PppoeLiveSnapshot.updateMany(filter, {
    $set: {
      status: 'offline',
      downloadMbps: 0,
      uploadMbps: 0,
      lastUpdateAt: now,
      source: 'mikrotik',
    },
  });

  return result.modifiedCount || 0;
}

async function syncMikrotikPppoeSnapshots(options = {}) {
  const tenantId = String(options.tenantId || defaultTenantId()).trim();
  const sessions = await getActivePppoeSessions();
  const activeUsernames = [];
  let online = 0;

  for (const session of sessions) {
    const pppoeUsername = normalizeUsername(session.username);
    if (!pppoeUsername) continue;
    activeUsernames.push(pppoeUsername);
    await upsertPppoeLiveSnapshot({
      tenantId,
      pppoeUsername,
      status: 'online',
      currentIp: session.currentIp,
      uptime: session.uptime,
      downloadBytes: session.downloadBytes,
      uploadBytes: session.uploadBytes,
      source: 'mikrotik',
      lastUpdateAt: new Date(),
    });
    online += 1;
  }

  const offlineMarked = await markMissingSessionsOffline(activeUsernames, tenantId);
  return {
    tenantId,
    online,
    offlineMarked,
    totalRead: sessions.length,
    syncedAt: new Date().toISOString(),
  };
}

async function syncAgentPppoeSnapshots(sessions = [], tenantId = defaultTenantId()) {
  const activeUsernames = [];
  let online = 0;

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const pppoeUsername = normalizeUsername(session.username);
    if (!pppoeUsername) continue;
    activeUsernames.push(pppoeUsername);
    await upsertPppoeLiveSnapshot({
      tenantId,
      pppoeUsername,
      status: 'online',
      currentIp: session.currentIp,
      uptime: session.uptime,
      service: session.service,
      callerId: session.callerId,
      downloadBytes: session.downloadBytes,
      uploadBytes: session.uploadBytes,
      source: 'agent',
      lastUpdateAt: new Date(),
    });
    online += 1;
  }

  const offlineMarked = await markMissingSessionsOffline(activeUsernames, tenantId);
  return {
    tenantId: String(tenantId),
    online,
    offlineMarked,
    totalRead: Array.isArray(sessions) ? sessions.length : 0,
    syncedAt: new Date().toISOString(),
  };
}

module.exports = {
  upsertPppoeLiveSnapshot,
  markMissingSessionsOffline,
  syncMikrotikPppoeSnapshots,
  syncAgentPppoeSnapshots,
};
