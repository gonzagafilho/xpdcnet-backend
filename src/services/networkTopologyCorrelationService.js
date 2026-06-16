const NetworkNode = require('../models/NetworkNode');
const NetworkTopologyLink = require('../models/NetworkTopologyLink');
const NetworkInterfaceInventory = require('../models/NetworkInterfaceInventory');

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function classifyInterfaceLink(iface) {
  const name = String(iface.name || '').toLowerCase();
  const type = String(iface.type || '').toLowerCase();

  if (name.includes('wg') || name.includes('wireguard') || type.includes('wireguard')) return 'VPN';
  if (name.includes('sfp') || name.includes('fiber') || name.includes('fibra')) return 'FIBER';
  if (name.includes('ptp') || name.includes('ponto')) return 'PTP';
  if (name.includes('wlan') || name.includes('wifi') || type.includes('wlan') || type.includes('wireless')) return 'WIRELESS';
  if (name.includes('backbone') || name.includes('core') || name.includes('uplink')) return 'BACKBONE';
  if (type === 'ether' || name.startsWith('ether')) return 'POP_UPLINK';

  return 'OTHER';
}

function healthFromInterface(iface) {
  if (iface.disabled) {
    return { status: 'offline', healthScore: 0, healthLevel: 'offline' };
  }

  if (!iface.running) {
    return { status: 'degraded', healthScore: 50, healthLevel: 'warning' };
  }

  return { status: 'online', healthScore: 100, healthLevel: 'healthy' };
}

async function correlateTopologyFromInterfaces({ tenantId, networkNodeId }) {
  const node = await NetworkNode.findOne({
    _id: networkNodeId,
    tenantId,
    isActive: true,
  }).lean();

  if (!node) {
    return {
      ok: false,
      reason: 'node_not_found',
      correlated: 0,
    };
  }

  const coreNode = await NetworkNode.findOne({
    tenantId,
    type: 'LOCAL',
    isActive: true,
  }).lean();

  if (!coreNode) {
    return {
      ok: false,
      reason: 'core_node_not_found',
      correlated: 0,
    };
  }

  const interfaces = await NetworkInterfaceInventory.find({
    tenantId,
    networkNodeId,
  }).lean();

  const usable = interfaces.filter((iface) => {
    const name = String(iface.name || '').toLowerCase();
    const type = String(iface.type || '').toLowerCase();

    if (!name) return false;
    if (name === 'lo' || type === 'loopback') return false;

    return true;
  });

  let correlated = 0;
  const touched = [];

  for (const iface of usable) {
    const linkType = classifyInterfaceLink(iface);
    const health = healthFromInterface(iface);

    const code = normalizeCode(
      `IFACE_${coreNode.code}_${node.code}_${iface.name}`
    );

    const name = `${coreNode.name} ↔ ${node.name} / ${iface.name}`;

    await NetworkTopologyLink.findOneAndUpdate(
      {
        tenantId,
        code,
      },
      {
        $set: {
          tenantId,
          code,
          name,
          fromNodeId: coreNode._id,
          toNodeId: node._id,
          type: linkType,
          status: health.status,
          healthScore: health.healthScore,
          healthLevel: health.healthLevel,
          currentRxMbps: 0,
          currentTxMbps: 0,
          lastSampleAt: new Date(),
          isActive: true,
          config: {
            discovery: 'INTERFACE_CORRELATION_V1',
            interfaceName: iface.name,
            interfaceType: iface.type,
            macAddress: iface.macAddress,
            running: iface.running,
            disabled: iface.disabled,
            rxBytes: iface.rxBytes,
            txBytes: iface.txBytes,
            lastSeenAt: iface.lastSeenAt,
          },
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    correlated += 1;
    touched.push(code);
  }

  return {
    ok: true,
    correlated,
    totalInterfaces: interfaces.length,
    usableInterfaces: usable.length,
    touched,
  };
}

module.exports = {
  correlateTopologyFromInterfaces,
  classifyInterfaceLink,
  healthFromInterface,
};
