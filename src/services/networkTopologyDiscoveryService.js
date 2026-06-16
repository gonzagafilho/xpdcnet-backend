const NetworkNode = require('../models/NetworkNode');
const NetworkTopologyLink = require('../models/NetworkTopologyLink');

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function detectLinkType(fromNode, toNode) {
  const text = `${fromNode.name} ${fromNode.code} ${fromNode.host} ${toNode.name} ${toNode.code} ${toNode.host}`.toUpperCase();

  if (text.includes('PTP') || text.includes('PONTO')) return 'PTP';
  if (text.includes('FIBRA') || text.includes('FIBER')) return 'FIBER';
  if (text.includes('RADIO') || text.includes('WIRELESS') || text.includes('WIFI')) return 'WIRELESS';
  if (text.includes('VPN') || fromNode.type !== toNode.type) return 'VPN';
  if (text.includes('BACKBONE') || text.includes('CORE')) return 'BACKBONE';

  return 'POP_UPLINK';
}

function calculateLinkHealth(fromNode, toNode) {
  const fromScore = Number(fromNode.healthScore || 100);
  const toScore = Number(toNode.healthScore || 100);
  const score = Math.min(fromScore, toScore);

  if (fromNode.status === 'offline' && toNode.status === 'offline') {
    return { status: 'offline', healthScore: 0, healthLevel: 'offline' };
  }

  if (fromNode.status === 'offline' || toNode.status === 'offline') {
    return { status: 'degraded', healthScore: Math.min(score, 49), healthLevel: 'critical' };
  }

  if (score <= 49) return { status: 'degraded', healthScore: score, healthLevel: 'critical' };
  if (score <= 79) return { status: 'degraded', healthScore: score, healthLevel: 'warning' };

  return { status: 'online', healthScore: score, healthLevel: 'healthy' };
}

async function discoverTopologyLinks({ tenantId }) {
  const nodes = await NetworkNode.find({
    tenantId,
    isActive: true,
  })
    .select('name code type status host healthScore healthLevel isActive connectionMode')
    .lean();

  if (nodes.length < 2) {
    return {
      discovered: 0,
      reason: 'not_enough_nodes',
      totalNodes: nodes.length,
    };
  }

  const localNode =
    nodes.find((node) => node.type === 'LOCAL') ||
    nodes[0];

  let discovered = 0;
  const touchedCodes = [];

  for (const node of nodes) {
    if (String(node._id) === String(localNode._id)) continue;

    const linkType = detectLinkType(localNode, node);
    const health = calculateLinkHealth(localNode, node);

    const code = normalizeCode(`AUTO_${localNode.code}_${node.code}`);
    const name = `${localNode.name} ↔ ${node.name}`;

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
          fromNodeId: localNode._id,
          toNodeId: node._id,
          type: linkType,
          status: health.status,
          healthScore: health.healthScore,
          healthLevel: health.healthLevel,
          lastSampleAt: new Date(),
          isActive: true,
          config: {
            discovery: 'AUTO_V1',
            fromNodeCode: localNode.code,
            toNodeCode: node.code,
            fromNodeType: localNode.type,
            toNodeType: node.type,
          },
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    discovered += 1;
    touchedCodes.push(code);
  }

  return {
    discovered,
    totalNodes: nodes.length,
    localNodeCode: localNode.code,
    touchedCodes,
  };
}

module.exports = {
  discoverTopologyLinks,
  detectLinkType,
  calculateLinkHealth,
};
