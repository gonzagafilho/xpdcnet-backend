const NocIncident = require('../models/NocIncident');

async function openIncident({
  fingerprint,
  severity = 'warning',
  source = 'noc',
  title,
  message = '',
  metadata = {},
}) {
  if (!fingerprint || !title) {
    return null;
  }

  const existing = await NocIncident.findOne({
    fingerprint,
    status: 'open',
  }).lean();

  if (existing) {
    return existing;
  }

  return NocIncident.create({
    fingerprint,
    severity,
    source,
    title,
    message,
    metadata,
    status: 'open',
    startedAt: new Date(),
  });
}

async function resolveIncident(fingerprint, metadata = {}) {
  if (!fingerprint) return null;

  return NocIncident.findOneAndUpdate(
    {
      fingerprint,
      status: 'open',
    },
    {
      $set: {
        status: 'resolved',
        resolvedAt: new Date(),
        metadata,
      },
    },
    {
      new: true,
    },
  ).lean();
}

async function listOpenIncidents(limit = 20) {
  return NocIncident.find({ status: 'open' })
    .sort({ severity: 1, startedAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
    .lean();
}

async function listRecentIncidents(limit = 50) {
  return NocIncident.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
    .lean();
}

async function evaluateNocIncidents(payload = {}) {
  const queue = payload.queue || {};
  const workers = payload.workers || {};
  const agents = payload.agents || {};

  const actions = [];

  const failed = queue.failed || 0;
  const stale = queue.stale || 0;
  const pressure = queue.pressurePercent || 0;

  if (failed > 0) {
    actions.push(await openIncident({
      fingerprint: 'noc.queue.failed',
      severity: failed >= 5 ? 'critical' : 'warning',
      title: 'Jobs com falha detectados',
      message: `${failed} job(s) em estado failed na fila distribuída.`,
      metadata: { failed },
    }));
  } else {
    actions.push(await resolveIncident('noc.queue.failed', { failed }));
  }

  if (stale > 0) {
    actions.push(await openIncident({
      fingerprint: 'noc.queue.stale',
      severity: stale >= 3 ? 'critical' : 'warning',
      title: 'Jobs travados detectados',
      message: `${stale} job(s) em processing stale.`,
      metadata: { stale },
    }));
  } else {
    actions.push(await resolveIncident('noc.queue.stale', { stale }));
  }

  if (pressure >= 80) {
    actions.push(await openIncident({
      fingerprint: 'noc.queue.pressure',
      severity: pressure >= 95 ? 'critical' : 'warning',
      title: 'Pressão alta na fila',
      message: `Queue pressure em ${pressure}%.`,
      metadata: { pressurePercent: pressure },
    }));
  } else {
    actions.push(await resolveIncident('noc.queue.pressure', { pressurePercent: pressure }));
  }

  for (const name of ['sync', 'finance', 'trust']) {
    const worker = workers[name];
    const fingerprint = `noc.worker.${name}.offline`;

    if (worker && worker.status === 'offline') {
      actions.push(await openIncident({
        fingerprint,
        severity: 'critical',
        title: `Worker ${name} offline`,
        message: `Worker ${name} sem heartbeat dentro da janela operacional.`,
        metadata: worker,
      }));
    } else {
      actions.push(await resolveIncident(fingerprint, worker || {}));
    }
  }

  if ((agents.total || 0) > 0 && (agents.online || 0) === 0) {
    actions.push(await openIncident({
      fingerprint: 'noc.agents.all_offline',
      severity: 'critical',
      title: 'Todos os agents offline',
      message: 'Nenhum remote agent online no momento.',
      metadata: agents,
    }));
  } else {
    actions.push(await resolveIncident('noc.agents.all_offline', agents));
  }

  return actions.filter(Boolean);
}

module.exports = {
  openIncident,
  resolveIncident,
  listOpenIncidents,
  listRecentIncidents,
  evaluateNocIncidents,
};
