const NetworkTopologySnapshot = require('../models/NetworkTopologySnapshot');
const NetworkNode = require('../models/NetworkNode');
const NetworkTopologyLink = require('../models/NetworkTopologyLink');
const { buildTopologySnapshot } = require('../services/networkTopologyService');

function getTenantId(req) {
  return req.tenant?._id || req.user?.tenantId || req.headers['x-tenant-id'];
}


async function generateSnapshot(req, res) {
  try {
    const tenantId =
      req.tenant?._id ||
      req.user?.tenantId ||
      req.headers['x-tenant-id'];

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: 'tenant_required',
      });
    }

    const snapshot = await buildTopologySnapshot({
      tenantId,
    });

    return res.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    console.error('[topology.generateSnapshot]', error);

    return res.status(500).json({
      ok: false,
      error: 'topology_snapshot_failed',
    });
  }
}

async function getLatestSnapshot(req, res) {
  try {
    const tenantId =
      req.tenant?._id ||
      req.user?.tenantId ||
      req.headers['x-tenant-id'];

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: 'tenant_required',
      });
    }

    const snapshot = await NetworkTopologySnapshot
      .findOne({ tenantId })
      .sort({ sampledAt: -1 })
      .lean();

    return res.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    console.error('[topology.getLatestSnapshot]', error);

    return res.status(500).json({
      ok: false,
      error: 'topology_snapshot_fetch_failed',
    });
  }
}

async function getTopologyNodes(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_required' });
    }

    const nodes = await NetworkNode.find({ tenantId, isActive: true })
      .select('_id name code type status connectionMode host healthScore healthLevel healthUpdatedAt agentLastSeenAt config createdAt updatedAt')
      .sort({ type: 1, name: 1 })
      .lean();

    return res.json({ ok: true, total: nodes.length, nodes });
  } catch (error) {
    console.error('[topology.getTopologyNodes]', error);
    return res.status(500).json({ ok: false, error: 'topology_nodes_fetch_failed' });
  }
}

async function getTopologyLinks(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_required' });
    }

    const links = await NetworkTopologyLink.find({ tenantId, isActive: true })
      .select('_id name code fromNodeId toNodeId type status capacityMbps currentRxMbps currentTxMbps latencyMs packetLossPct healthScore healthLevel lastSampleAt config createdAt updatedAt')
      .sort({ type: 1, name: 1 })
      .lean();

    return res.json({ ok: true, total: links.length, links });
  } catch (error) {
    console.error('[topology.getTopologyLinks]', error);
    return res.status(500).json({ ok: false, error: 'topology_links_fetch_failed' });
  }
}

async function getTopologyOverview(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenant_required' });
    }

    const [snapshot, nodes, links] = await Promise.all([
      NetworkTopologySnapshot.findOne({ tenantId }).sort({ sampledAt: -1 }).lean(),
      NetworkNode.find({ tenantId, isActive: true })
        .select('_id name code type status connectionMode host healthScore healthLevel agentLastSeenAt')
        .sort({ type: 1, name: 1 })
        .lean(),
      NetworkTopologyLink.find({ tenantId, isActive: true })
        .select('_id name code fromNodeId toNodeId type status healthScore healthLevel lastSampleAt')
        .sort({ type: 1, name: 1 })
        .lean(),
    ]);

    return res.json({
      ok: true,
      overview: {
        snapshot,
        nodes,
        links,
      },
    });
  } catch (error) {
    console.error('[topology.getTopologyOverview]', error);
    return res.status(500).json({ ok: false, error: 'topology_overview_fetch_failed' });
  }
}

module.exports = {
  generateSnapshot,
  getLatestSnapshot,
  getTopologyNodes,
  getTopologyLinks,
  getTopologyOverview,
};
