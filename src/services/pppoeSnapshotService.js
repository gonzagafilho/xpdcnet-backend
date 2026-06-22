const mongoose = require('mongoose');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');
const { getPppoeStateFromConcentrator } = require('./mikrotikRouterosService');

async function assertPppoeSnapshotIndexes() {
  let indexes;
  try {
    indexes = await PppoeLiveSnapshot.collection.indexes();
  } catch (err) {
    if (err?.codeName === 'NamespaceNotFound') {
      throw new Error('Colecao PppoeLiveSnapshot ausente; prepare a migracao antes de iniciar o worker.');
    }
    throw err;
  }

  const expected = indexes.find((index) => (
    index.unique === true
    && index.key?.tenantId === 1
    && index.key?.concentratorId === 1
    && index.key?.pppoeUsername === 1
    && Object.keys(index.key).length === 3
  ));
  if (!expected) {
    throw new Error('Indice PPPoE multi-concentrador ausente; execute migracao controlada antes do worker.');
  }

  const legacy = indexes.find((index) => (
    index.unique === true
    && index.key?.tenantId === 1
    && index.key?.pppoeUsername === 1
    && Object.keys(index.key).length === 2
  ));
  if (legacy) {
    throw new Error(`Indice PPPoE legado ainda ativo (${legacy.name}); remova-o em migracao controlada.`);
  }

  return true;
}

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

function objectIdOrNull(value) {
  return value && mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function calculateMbps(previous, currentBytes, previousKey, sampledAt) {
  if (!previous || previous[previousKey] == null || !previous.lastUpdateAt) return 0;
  const deltaBytes = numberValue(currentBytes) - numberValue(previous[previousKey]);
  if (deltaBytes <= 0) return 0;
  const seconds = Math.max((sampledAt.getTime() - new Date(previous.lastUpdateAt).getTime()) / 1000, 1);
  return Number(((deltaBytes * 8) / seconds / 1000000).toFixed(2));
}

function snapshotContext(value = {}) {
  const tenantId = String(value.tenantId || '').trim();
  const concentratorId = objectIdOrNull(value.concentratorId);
  const concentratorName = trimSafe(value.concentratorName, 160);
  const agentNodeId = objectIdOrNull(value.agentNodeId);

  if (!tenantId) throw new Error('tenantId ausente para snapshot PPPoE.');
  if (!concentratorId) throw new Error('concentratorId ausente ou invalido para snapshot PPPoE.');
  if (!concentratorName) throw new Error('concentratorName ausente para snapshot PPPoE.');
  if (!agentNodeId) throw new Error('agentNodeId ausente ou invalido para snapshot PPPoE.');

  return { tenantId, concentratorId, concentratorName, agentNodeId };
}

async function upsertPppoeLiveSnapshot(snapshot = {}) {
  const context = snapshotContext(snapshot);
  const pppoeUsername = normalizeUsername(snapshot.pppoeUsername || snapshot.username);
  if (!pppoeUsername) throw new Error('pppoeUsername ausente para snapshot PPPoE.');

  const lastUpdateAt = snapshot.lastUpdateAt ? new Date(snapshot.lastUpdateAt) : new Date();
  const key = {
    tenantId: context.tenantId,
    concentratorId: context.concentratorId,
    pppoeUsername,
  };
  const previous = await PppoeLiveSnapshot.findOne(key).lean();
  const downloadBytes = numberValue(snapshot.downloadBytes);
  const uploadBytes = numberValue(snapshot.uploadBytes);
  const downloadMbps = snapshot.downloadMbps != null
    ? numberValue(snapshot.downloadMbps)
    : calculateMbps(previous, downloadBytes, 'downloadBytes', lastUpdateAt);
  const uploadMbps = snapshot.uploadMbps != null
    ? numberValue(snapshot.uploadMbps)
    : calculateMbps(previous, uploadBytes, 'uploadBytes', lastUpdateAt);

  return PppoeLiveSnapshot.findOneAndUpdate(
    key,
    {
      $set: {
        concentratorName: context.concentratorName,
        agentNodeId: context.agentNodeId,
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
      $setOnInsert: key,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
}

async function markMissingSessionsOffline(activeUsernames = [], context = {}) {
  const safeContext = snapshotContext(context);
  const active = activeUsernames.map(normalizeUsername).filter(Boolean);
  const filter = {
    tenantId: safeContext.tenantId,
    concentratorId: safeContext.concentratorId,
    status: 'online',
  };
  if (active.length) filter.pppoeUsername = { $nin: active };

  const result = await PppoeLiveSnapshot.updateMany(filter, {
    $set: {
      status: 'offline',
      downloadMbps: 0,
      uploadMbps: 0,
      lastUpdateAt: new Date(),
      source: context.source || 'mikrotik',
    },
  });
  return result.modifiedCount || 0;
}

async function syncSessions(sessions, context, secretUsernames = []) {
  const safeContext = snapshotContext(context);
  const activeUsernames = [];
  let online = 0;
  const sampledAt = new Date();

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const pppoeUsername = normalizeUsername(session.username);
    if (!pppoeUsername) continue;
    activeUsernames.push(pppoeUsername);
    await upsertPppoeLiveSnapshot({
      ...safeContext,
      source: context.source,
      pppoeUsername,
      status: 'online',
      currentIp: session.currentIp,
      uptime: session.uptime,
      service: session.service,
      callerId: session.callerId,
      downloadBytes: session.downloadBytes,
      uploadBytes: session.uploadBytes,
      lastUpdateAt: sampledAt,
    });
    online += 1;
  }

  const activeSet = new Set(activeUsernames);
  let offline = 0;
  for (const username of [...new Set(secretUsernames.map(normalizeUsername).filter(Boolean))]) {
    if (activeSet.has(username)) continue;
    await upsertPppoeLiveSnapshot({
      ...safeContext,
      source: context.source,
      pppoeUsername: username,
      status: 'offline',
      currentIp: null,
      uptime: null,
      service: 'pppoe',
      callerId: null,
      downloadBytes: 0,
      uploadBytes: 0,
      downloadMbps: 0,
      uploadMbps: 0,
      lastUpdateAt: sampledAt,
    });
    offline += 1;
  }

  const offlineMarked = await markMissingSessionsOffline(activeUsernames, {
    ...safeContext,
    source: context.source,
  });
  return {
    online,
    offline,
    offlineMarked,
    totalRead: Array.isArray(sessions) ? sessions.length : 0,
    totalSecrets: new Set(secretUsernames.map(normalizeUsername).filter(Boolean)).size,
    syncedAt: sampledAt.toISOString(),
  };
}

async function syncMikrotikPppoeSnapshotsForConcentrator(concentrator) {
  if (!concentrator?._id) throw new Error('Concentrador invalido para sincronizacao PPPoE.');
  const state = await getPppoeStateFromConcentrator(concentrator);
  const result = await syncSessions(state.activeSessions, {
    tenantId: String(concentrator.tenantId),
    concentratorId: concentrator._id,
    concentratorName: concentrator.name,
    agentNodeId: concentrator.agentNodeId,
    source: 'mikrotik',
  }, state.secretUsernames);
  return {
    ...result,
    concentratorId: String(concentrator._id),
    concentratorName: concentrator.name,
    agentNodeId: concentrator.agentNodeId ? String(concentrator.agentNodeId) : null,
  };
}

async function syncAgentPppoeSnapshots(sessions = [], concentrator) {
  if (!concentrator?._id) throw new Error('Concentrador ausente para snapshot PPPoE do agente.');
  return {
    tenantId: String(concentrator.tenantId),
    ...(await syncSessions(sessions, {
      tenantId: String(concentrator.tenantId),
      concentratorId: concentrator._id,
      concentratorName: concentrator.name,
      agentNodeId: concentrator.agentNodeId,
      source: 'agent',
    })),
    concentratorId: String(concentrator._id),
    concentratorName: concentrator.name,
  };
}

module.exports = {
  assertPppoeSnapshotIndexes,
  upsertPppoeLiveSnapshot,
  markMissingSessionsOffline,
  syncMikrotikPppoeSnapshotsForConcentrator,
  syncAgentPppoeSnapshots,
  syncSessions,
};
