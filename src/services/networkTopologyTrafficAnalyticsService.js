const NetworkTopologyLink = require('../models/NetworkTopologyLink');
const NetworkTopologyTrafficSnapshot = require('../models/NetworkTopologyTrafficSnapshot');

function calcUtilization(totalMbps, capacityMbps) {
  const cap = Number(capacityMbps || 0);
  if (!cap || cap <= 0) return 0;

  return Number(Math.min(100, ((Number(totalMbps || 0) / cap) * 100)).toFixed(2));
}

function detectTrafficAlert(link, utilizationPct) {
  if (link.status === 'offline' || link.healthLevel === 'offline') {
    return { isAlerted: true, alertType: 'LINK_OFFLINE' };
  }

  if (link.healthLevel === 'critical') {
    return { isAlerted: true, alertType: 'LINK_CRITICAL' };
  }

  if (utilizationPct >= 90) {
    return { isAlerted: true, alertType: 'LINK_SATURATION_CRITICAL' };
  }

  if (utilizationPct >= 80) {
    return { isAlerted: true, alertType: 'LINK_SATURATION_WARNING' };
  }

  if (link.status === 'degraded' || link.healthLevel === 'warning') {
    return { isAlerted: true, alertType: 'LINK_DEGRADED' };
  }

  return { isAlerted: false, alertType: null };
}

async function collectTopologyTrafficSnapshot({ tenantId }) {
  const links = await NetworkTopologyLink.find({
    tenantId,
    isActive: true,
  }).lean();

  const rows = [];

  for (const link of links) {
    const rxMbps = Number(link.currentRxMbps || 0);
    const txMbps = Number(link.currentTxMbps || 0);
    const totalMbps = Number((rxMbps + txMbps).toFixed(3));
    const capacityMbps = Number(link.capacityMbps || 0);
    const utilizationPct = calcUtilization(totalMbps, capacityMbps);
    const alert = detectTrafficAlert(link, utilizationPct);

    const row = await NetworkTopologyTrafficSnapshot.create({
      tenantId,
      linkId: link._id,
      linkCode: link.code,
      linkName: link.name,
      rxMbps,
      txMbps,
      totalMbps,
      capacityMbps,
      utilizationPct,
      status: link.status || 'unknown',
      healthLevel: link.healthLevel || 'healthy',
      isAlerted: alert.isAlerted,
      alertType: alert.alertType,
      sampledAt: new Date(),
    });

    rows.push({
      linkCode: row.linkCode,
      rxMbps: row.rxMbps,
      txMbps: row.txMbps,
      totalMbps: row.totalMbps,
      utilizationPct: row.utilizationPct,
      isAlerted: row.isAlerted,
      alertType: row.alertType,
    });
  }

  return {
    ok: true,
    totalLinks: links.length,
    totalSnapshots: rows.length,
    rows,
  };
}

module.exports = {
  collectTopologyTrafficSnapshot,
  calcUtilization,
  detectTrafficAlert,
};
