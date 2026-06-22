const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');
const clientStatusService = require('./clientStatusService');

const tenantId = new mongoose.Types.ObjectId();
const clientId = new mongoose.Types.ObjectId();

function mockClient(status) {
  Client.find = () => ({
    select: () => ({
      lean: async () => [{ _id: clientId, status }],
    }),
  });
  Client.updateMany = async (_filter, update) => ({
    modifiedCount: update.$set.status ? 1 : 0,
  });
  ClientAccess.updateMany = async (_filter, update) => ({
    modifiedCount: update.$set.status ? 2 : 0,
  });
}

test('altera cliente e acessos sem usar serviços RouterOS', async (t) => {
  const originalFind = Client.find;
  const originalClientUpdateMany = Client.updateMany;
  const originalAccessUpdateMany = ClientAccess.updateMany;
  t.after(() => {
    Client.find = originalFind;
    Client.updateMany = originalClientUpdateMany;
    ClientAccess.updateMany = originalAccessUpdateMany;
  });

  mockClient('pending');
  const result = await clientStatusService.updateOne(tenantId, clientId, 'active');

  assert.equal(result.updatedClients, 1);
  assert.equal(result.updatedAccesses, 2);
  assert.deepEqual(result.items[0], {
    id: String(clientId),
    previousStatus: 'pending',
    status: 'active',
  });
});

test('bloqueia transição individual fora do fluxo operacional', async (t) => {
  const originalFind = Client.find;
  const originalClientUpdateMany = Client.updateMany;
  const originalAccessUpdateMany = ClientAccess.updateMany;
  t.after(() => {
    Client.find = originalFind;
    Client.updateMany = originalClientUpdateMany;
    ClientAccess.updateMany = originalAccessUpdateMany;
  });

  mockClient('cancelled');

  await assert.rejects(
    clientStatusService.updateOne(tenantId, clientId, 'active'),
    (error) => error.statusCode === 409 && error.code === 'CLIENT_STATUS_TRANSITION_NOT_ALLOWED',
  );
});

test('restaura status do cliente se a atualização dos acessos falhar', async (t) => {
  const originalFind = Client.find;
  const originalClientUpdateMany = Client.updateMany;
  const originalClientBulkWrite = Client.bulkWrite;
  const originalAccessUpdateMany = ClientAccess.updateMany;
  t.after(() => {
    Client.find = originalFind;
    Client.updateMany = originalClientUpdateMany;
    Client.bulkWrite = originalClientBulkWrite;
    ClientAccess.updateMany = originalAccessUpdateMany;
  });

  let rollbackOperations = null;
  Client.find = () => ({
    select: () => ({ lean: async () => [{ _id: clientId, status: 'pending' }] }),
  });
  Client.updateMany = async () => ({ modifiedCount: 1 });
  ClientAccess.updateMany = async () => {
    throw new Error('falha simulada');
  };
  Client.bulkWrite = async (operations) => {
    rollbackOperations = operations;
  };

  await assert.rejects(
    clientStatusService.updateOne(tenantId, clientId, 'active'),
    /falha simulada/,
  );
  assert.equal(rollbackOperations.length, 1);
  assert.equal(rollbackOperations[0].updateOne.update.$set.status, 'pending');
});
