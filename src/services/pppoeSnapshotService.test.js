const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');
const { syncSessions } = require('./pppoeSnapshotService');

test('reconcilia active como online e secret ausente como offline por concentrador', async (t) => {
  const originalFindOne = PppoeLiveSnapshot.findOne;
  const originalFindOneAndUpdate = PppoeLiveSnapshot.findOneAndUpdate;
  const originalUpdateMany = PppoeLiveSnapshot.updateMany;
  t.after(() => {
    PppoeLiveSnapshot.findOne = originalFindOne;
    PppoeLiveSnapshot.findOneAndUpdate = originalFindOneAndUpdate;
    PppoeLiveSnapshot.updateMany = originalUpdateMany;
  });

  const writes = [];
  PppoeLiveSnapshot.findOne = () => ({ lean: async () => null });
  PppoeLiveSnapshot.findOneAndUpdate = (filter, update) => ({
    lean: async () => {
      writes.push({ filter, status: update.$set.status, currentIp: update.$set.currentIp });
      return { ...filter, ...update.$set };
    },
  });
  PppoeLiveSnapshot.updateMany = async () => ({ modifiedCount: 0 });

  const tenantId = new mongoose.Types.ObjectId().toString();
  const concentratorId = new mongoose.Types.ObjectId();
  const agentNodeId = new mongoose.Types.ObjectId();
  const result = await syncSessions(
    [{ username: 'online-user', currentIp: '10.0.0.2', uptime: '1h' }],
    { tenantId, concentratorId, concentratorName: 'CHACARA STARLINK', agentNodeId, source: 'mikrotik' },
    ['online-user', 'offline-user'],
  );

  assert.equal(result.online, 1);
  assert.equal(result.offline, 1);
  assert.equal(result.totalSecrets, 2);
  assert.deepEqual(writes.map((row) => [row.filter.pppoeUsername, row.status]), [
    ['online-user', 'online'],
    ['offline-user', 'offline'],
  ]);
  assert.equal(writes[1].currentIp, null);
  assert.equal(String(writes[1].filter.concentratorId), String(concentratorId));
});
