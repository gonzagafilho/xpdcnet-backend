const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');
const { createCustomerWithAccesses } = require('./dataImportMultiAccessService');

function fixture(accesses) {
  return {
    tenantId: new mongoose.Types.ObjectId(),
    server: { _id: new mongoose.Types.ObjectId() },
    node: { _id: new mongoose.Types.ObjectId() },
    job: { originalFilename: 'chacarra.csv' },
    customer: {
      fullName: 'Cliente Teste',
      document: '52998224725',
      sourceData: accesses.map((row, index) => ({
        rowNumber: index + 2,
        fullName: 'Cliente Teste',
        document: '52998224725',
        planId: row.planId,
        monthlyPrice: row.monthlyPrice || 80,
        planAuthType: 'pppoe',
        planProfile: '',
        pppoeUsername: row.username,
        pppoePassword: 'senha',
      })),
    },
  };
}

async function withModelStubs(run) {
  const original = {
    create: Client.create,
    clientDelete: Client.deleteOne,
    insertMany: ClientAccess.insertMany,
    accessDelete: ClientAccess.deleteMany,
  };
  const captured = { clients: [], accesses: [] };
  Client.create = async (payload) => {
    captured.clients.push(payload);
    return { _id: new mongoose.Types.ObjectId() };
  };
  Client.deleteOne = async () => ({ deletedCount: 1 });
  ClientAccess.insertMany = async (payload) => {
    captured.accesses.push(...payload);
    return payload;
  };
  ClientAccess.deleteMany = async () => ({ deletedCount: captured.accesses.length });
  try {
    await run(captured);
  } finally {
    Client.create = original.create;
    Client.deleteOne = original.clientDelete;
    ClientAccess.insertMany = original.insertMany;
    ClientAccess.deleteMany = original.accessDelete;
  }
}

test('confirmação prepara cliente legado e um ClientAccess', async () => {
  await withModelStubs(async (captured) => {
    const planId = new mongoose.Types.ObjectId();
    const result = await createCustomerWithAccesses(fixture([{ username: 'acesso.um', planId } ]));
    assert.equal(result.accessCount, 1);
    assert.equal(captured.clients[0].access.username, 'acesso.um');
    assert.equal(captured.accesses.length, 1);
  });
});

test('confirmação prepara um cliente e dois acessos com planos diferentes', async () => {
  await withModelStubs(async (captured) => {
    const firstPlan = new mongoose.Types.ObjectId();
    const secondPlan = new mongoose.Types.ObjectId();
    const result = await createCustomerWithAccesses(fixture([
      { username: 'acesso.um', planId: firstPlan },
      { username: 'acesso.dois', planId: secondPlan },
    ]));
    assert.equal(result.accessCount, 2);
    assert.equal(captured.clients.length, 1);
    assert.equal(captured.accesses.length, 2);
    assert.notEqual(String(captured.accesses[0].planId), String(captured.accesses[1].planId));
  });
});
