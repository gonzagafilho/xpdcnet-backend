require('dotenv').config();

const mongoose = require('mongoose');
const NetworkNode = require('../models/NetworkNode');
const networkIncidentEngine = require('../services/networkIncidentEngine');
const { markWorkerHeartbeat } = require('../services/workerTelemetryService');

const LOG = '[networkIncidentStaleWorker]';

const INTERVAL_MS = Number(process.env.STALE_WORKER_INTERVAL_MS || 60000);
const AGENT_STALE_MS = Number(process.env.AGENT_STALE_MS || 120000);
const AGENT_OFFLINE_MS = Number(process.env.AGENT_OFFLINE_MS || 300000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI ausente no .env');
  }

  await mongoose.connect(uri);
  console.log(`${LOG} MongoDB conectado`);
}

async function evaluateNode(node) {
  const now = Date.now();
  const tenantId = String(node.tenantId);
  const nodeId = String(node._id);

  const lastSeenAt = node.agentLastSeenAt
    ? new Date(node.agentLastSeenAt).getTime()
    : 0;

  const ageMs = lastSeenAt > 0 ? now - lastSeenAt : Number.MAX_SAFE_INTEGER;

  if (!lastSeenAt || ageMs >= AGENT_OFFLINE_MS) {
    await NetworkNode.updateOne(
      { _id: node._id },
      { $set: { status: 'offline' } }
    );

    await networkIncidentEngine.openOrTouchIncident({
      tenantId,
      nodeId,
      type: 'AGENT_OFFLINE',
      severity: 'critical',
      title: 'Agent offline',
      message: 'O Agent não envia heartbeat há mais de 5 minutos.',
      metadata: {
        ageMs,
        agentLastSeenAt: node.agentLastSeenAt || null,
      },
    });

    return 'offline';
  }

  if (ageMs >= AGENT_STALE_MS) {
    await NetworkNode.updateOne(
      { _id: node._id },
      { $set: { status: 'unknown' } }
    );

    await networkIncidentEngine.openOrTouchIncident({
      tenantId,
      nodeId,
      type: 'AGENT_STALE',
      severity: 'warning',
      title: 'Agent sem heartbeat recente',
      message: 'O Agent está sem heartbeat dentro da janela operacional.',
      metadata: {
        ageMs,
        agentLastSeenAt: node.agentLastSeenAt || null,
      },
    });

    return 'stale';
  }

  await NetworkNode.updateOne(
    { _id: node._id },
    { $set: { status: 'online' } }
  );

  await networkIncidentEngine.resolveOpenIncidents({
    tenantId,
    nodeId,
    types: ['AGENT_STALE', 'AGENT_OFFLINE'],
    message: 'Agent voltou a enviar heartbeat dentro da janela operacional.',
    metadata: {
      ageMs,
      agentLastSeenAt: node.agentLastSeenAt || null,
    },
  });

  return 'online';
}

async function runOnce() {
  await connectMongo();

  const nodes = await NetworkNode.find({
    type: 'REMOTE_AGENT',
    isActive: true,
  }).lean();

  const counters = {
    online: 0,
    stale: 0,
    offline: 0,
    error: 0,
  };

  for (const node of nodes) {
    try {
      const state = await evaluateNode(node);
      counters[state] = (counters[state] || 0) + 1;
    } catch (err) {
      counters.error += 1;
      console.error(`${LOG} erro node=${node._id}:`, err.message);
    }
  }

  console.log(
    `${LOG} checked=${nodes.length} online=${counters.online} stale=${counters.stale} offline=${counters.offline} error=${counters.error}`
  );

  return {
    checked: nodes.length,
    ...counters,
  };
}

async function main() {
  console.log(`${LOG} iniciado interval=${INTERVAL_MS} stale=${AGENT_STALE_MS} offline=${AGENT_OFFLINE_MS}`);

  while (true) {
    const startedAt = Date.now();
    try {
      const summary = await runOnce();
      await markWorkerHeartbeat('stale', {
        success: true,
        status: summary.error > 0 ? 'degraded' : 'online',
        lastDurationMs: Date.now() - startedAt,
        metadata: summary,
      });
    } catch (err) {
      console.error(`${LOG} erro geral:`, err && err.message ? err.message : err);
      await markWorkerHeartbeat('stale', {
        status: 'degraded',
        errorMessage: err && err.message ? err.message : String(err),
        lastDurationMs: Date.now() - startedAt,
      }).catch(() => {});
    }

    await sleep(INTERVAL_MS);
  }
}

main();
