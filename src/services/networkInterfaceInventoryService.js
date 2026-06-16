const NetworkInterfaceInventory = require('../models/NetworkInterfaceInventory');

function toNumber(value) {
  const n = Number(String(value ?? '0').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toBool(value) {
  return value === true || value === 'true' || value === 'yes';
}

function calcMbps(currentBytes, previousBytes, deltaSeconds) {
  if (!Number.isFinite(currentBytes)) return 0;
  if (!Number.isFinite(previousBytes)) return 0;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  if (currentBytes < previousBytes) return 0;

  return Number((((currentBytes - previousBytes) * 8) / deltaSeconds / 1000000).toFixed(3));
}

async function persistInterfaceDiscovery({
  tenantId,
  networkNodeId,
  commandId,
  interfaces,
}) {
  const list = Array.isArray(interfaces) ? interfaces : [];
  const touched = [];
  const now = new Date();

  for (const item of list) {
    const name = String(item.name || '').trim();
    if (!name) continue;

    const current = await NetworkInterfaceInventory.findOne({
      tenantId,
      networkNodeId,
      name,
    }).lean();

    const rxBytes = toNumber(item['rx-byte'] || item['rx-bytes']);
    const txBytes = toNumber(item['tx-byte'] || item['tx-bytes']);

    const prevRxBytes = current?.rxBytes || 0;
    const prevTxBytes = current?.txBytes || 0;
    const prevSampleAt = current?.lastSeenAt || null;

    const deltaSeconds = prevSampleAt
      ? (now.getTime() - new Date(prevSampleAt).getTime()) / 1000
      : 0;

    const currentRxMbps = calcMbps(rxBytes, prevRxBytes, deltaSeconds);
    const currentTxMbps = calcMbps(txBytes, prevTxBytes, deltaSeconds);

    const row = await NetworkInterfaceInventory.findOneAndUpdate(
      { tenantId, networkNodeId, name },
      {
        $set: {
          tenantId,
          networkNodeId,
          commandId,
          interfaceId: String(item['.id'] || ''),
          name,
          defaultName: String(item['default-name'] || ''),
          type: String(item.type || ''),
          macAddress: String(item['mac-address'] || ''),
          mtu: toNumber(item.mtu),
          actualMtu: toNumber(item['actual-mtu']),
          running: toBool(item.running),
          disabled: toBool(item.disabled),
          prevRxBytes,
          prevTxBytes,
          prevSampleAt,
          rxBytes,
          txBytes,
          currentRxMbps,
          currentTxMbps,
          rxPackets: toNumber(item['rx-packet']),
          txPackets: toNumber(item['tx-packet']),
          linkDowns: toNumber(item['link-downs']),
          lastLinkUpTime: String(item['last-link-up-time'] || ''),
          metadata: item,
          lastSeenAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    touched.push({
      name: row.name,
      rxMbps: row.currentRxMbps,
      txMbps: row.currentTxMbps,
    });
  }

  return {
    totalReceived: list.length,
    totalPersisted: touched.length,
    touched,
  };
}

module.exports = {
  persistInterfaceDiscovery,
  calcMbps,
};
