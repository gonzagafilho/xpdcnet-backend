const NetworkTopologyLink = require('../models/NetworkTopologyLink');
const NetworkInterfaceInventory = require('../models/NetworkInterfaceInventory');

function calcMbps(deltaBytes, deltaSeconds) {
  if (!Number.isFinite(deltaBytes) || !Number.isFinite(deltaSeconds)) return 0;
  if (deltaBytes <= 0 || deltaSeconds <= 0) return 0;
  return Number(((deltaBytes * 8) / deltaSeconds / 1000000).toFixed(3));
}

function healthFromInterface(iface) {
  if (!iface || iface.disabled) {
    return { status: 'offline', healthScore: 0, healthLevel: 'offline' };
  }

  if (!iface.running) {
    return { status: 'degraded', healthScore: 50, healthLevel: 'warning' };
  }

  return { status: 'online', healthScore: 100, healthLevel: 'healthy' };
}

async function updateTopologyHealthFromInterfaces({ tenantId, networkNodeId }) {
  const interfaces = await NetworkInterfaceInventory.find({
    tenantId,
    networkNodeId,
  }).lean();

  let updated = 0;
  const touched = [];

  for (const iface of interfaces) {
    const name = String(iface.name || '').trim();
    if (!name || name === 'lo' || iface.type === 'loopback') continue;

    const health = healthFromInterface(iface);

    const codeSuffix = name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const link = await NetworkTopologyLink.findOne({
      tenantId,
      code: { $regex: `_${codeSuffix}$` },
      isActive: true,
    }).lean();

    if (!link) continue;

    await NetworkTopologyLink.updateOne(
      { _id: link._id },
      {
        $set: {
          status: health.status,
          healthScore: health.healthScore,
          healthLevel: health.healthLevel,
          currentRxMbps: iface.currentRxMbps || 0,
          currentTxMbps: iface.currentTxMbps || 0,
          lastSampleAt: new Date(),
          'config.healthEngine': 'LINK_HEALTH_V1',
          'config.rxBytes': iface.rxBytes || 0,
          'config.txBytes': iface.txBytes || 0,
          'config.currentRxMbps': iface.currentRxMbps || 0,
          'config.currentTxMbps': iface.currentTxMbps || 0,
          'config.running': Boolean(iface.running),
          'config.disabled': Boolean(iface.disabled),
        },
      }
    );

    updated += 1;
    touched.push(link.code);
  }

  return {
    ok: true,
    updated,
    totalInterfaces: interfaces.length,
    touched,
  };
}

module.exports = {
  calcMbps,
  healthFromInterface,
  updateTopologyHealthFromInterfaces,
};
