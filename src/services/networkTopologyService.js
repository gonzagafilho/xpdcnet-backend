const NetworkNode = require('../models/NetworkNode');
const NetworkTopologyLink = require('../models/NetworkTopologyLink');
const NetworkTopologySnapshot = require('../models/NetworkTopologySnapshot');
const { discoverTopologyLinks } = require('./networkTopologyDiscoveryService');

function levelFromScore(score) {
  if (score <= 0) return 'offline';
  if (score <= 49) return 'critical';
  if (score <= 79) return 'warning';
  return 'healthy';
}

async function buildTopologySnapshot({ tenantId }) {
  const discovery = await discoverTopologyLinks({ tenantId });
  const nodes = await NetworkNode.find({
    tenantId,
    isActive: true,
  })
    .select('status healthScore healthLevel')
    .lean();

  const links = await NetworkTopologyLink.find({
    tenantId,
    isActive: true,
  })
    .select('status healthScore healthLevel')
    .lean();

  const totalNodes = nodes.length;
  const onlineNodes = nodes.filter((n) => n.status === 'online').length;
  const offlineNodes = nodes.filter((n) => n.status === 'offline').length;
  const degradedNodes = nodes.filter((n) => n.healthLevel === 'warning' || n.healthLevel === 'critical').length;

  const totalLinks = links.length;
  const onlineLinks = links.filter((l) => l.status === 'online').length;
  const degradedLinks = links.filter((l) => l.status === 'degraded').length;
  const offlineLinks = links.filter((l) => l.status === 'offline').length;

  const scores = [
    ...nodes.map((n) => Number(n.healthScore || 100)),
    ...links.map((l) => Number(l.healthScore || 100)),
  ];

  const avgHealthScore = scores.length
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : 100;

  const topologyHealthLevel = levelFromScore(avgHealthScore);

  return NetworkTopologySnapshot.create({
    tenantId,
    totalNodes,
    onlineNodes,
    offlineNodes,
    degradedNodes,
    totalLinks,
    onlineLinks,
    degradedLinks,
    offlineLinks,
    avgHealthScore,
    topologyHealthLevel,
    raw: {
      discovery,
      nodes: {
        total: totalNodes,
        online: onlineNodes,
        offline: offlineNodes,
        degraded: degradedNodes,
      },
      links: {
        total: totalLinks,
        online: onlineLinks,
        degraded: degradedLinks,
        offline: offlineLinks,
      },
    },
  });
}

module.exports = {
  buildTopologySnapshot,
  levelFromScore,
};
