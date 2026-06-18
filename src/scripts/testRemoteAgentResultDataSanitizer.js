const assert = require('assert');
const { sanitizeRemoteAgentResultData } = require('../services/remoteAgentResultDataSanitizer');

const concentrator = sanitizeRemoteAgentResultData('NETWORK_CONCENTRATOR_TEST', {
  status: 'online',
  latencyMs: 12.7,
  pppoeActiveCount: 8,
  systemIdentity: 'CCR LAB',
  admin: true,
  role: 'superadmin',
  internalData: { secret: 'x' },
  debug: { raw: true },
  secret: 'hidden',
});
assert.deepStrictEqual(concentrator, {
  status: 'online',
  latencyMs: 13,
  pppoeActiveCount: 8,
  systemIdentity: 'CCR LAB',
});

const ppp = sanitizeRemoteAgentResultData('READ_PPP_ACTIVE', {
  total: 1,
  sessions: [{ name: 'cliente_01', address: '100.64.0.10', uptime: '1h', password: 'x', debug: true }],
  unexpectedField: 'drop',
});
assert.deepStrictEqual(ppp, {
  sessions: [{ name: 'cliente_01', address: '100.64.0.10', uptime: '1h' }],
  total: 1,
});

const wrappedPpp = sanitizeRemoteAgentResultData('READ_PPP_ACTIVE', {
  raw: {
    pppActive: { items: [{ username: 'cliente_02', currentIp: '100.64.0.11', address: '100.64.0.11', secret: 'x' }], total: 1 },
    debug: { raw: true },
  },
  admin: true,
});
assert.deepStrictEqual(wrappedPpp, {
  raw: { pppActive: { items: [{ username: 'cliente_02', address: '100.64.0.11', currentIp: '100.64.0.11' }], total: 1 } },
});

const interfaces = sanitizeRemoteAgentResultData('READ_INTERFACE_DISCOVERY', [{
  '.id': '*1',
  name: 'ether1',
  running: true,
  'rx-byte': '100',
  admin: true,
  secret: 'drop',
}]);
assert.deepStrictEqual(interfaces, [{ '.id': '*1', name: 'ether1', running: true, 'rx-byte': '100' }]);

const generic = sanitizeRemoteAgentResultData('FUTURE_COMMAND', {
  status: 'done',
  score: 90,
  durationMs: 15,
  metadata: { source: 'agent', hostname: 'lab', token: 'drop' },
  role: 'superadmin',
});
assert.deepStrictEqual(generic, {
  status: 'done',
  score: 90,
  durationMs: 15,
  metadata: { source: 'agent', hostname: 'lab' },
});

const mongoose = require('mongoose');
const RemoteAgentCommand = require('../models/RemoteAgentCommand');
const model = new RemoteAgentCommand({
  tenantId: new mongoose.Types.ObjectId(),
  networkNodeId: new mongoose.Types.ObjectId(),
  kind: 'NETWORK_CONCENTRATOR_TEST',
  resultData: concentrator,
});
assert.strictEqual(model.validateSync(), undefined);
assert.deepStrictEqual(model.resultData, concentrator);

console.log('remoteAgentResultDataSanitizer: 6 cenarios validados');
