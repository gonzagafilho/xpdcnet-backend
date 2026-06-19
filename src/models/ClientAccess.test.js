const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Client = require('./Client');
const ClientAccess = require('./ClientAccess');

const ids = () => ({
  tenantId: new mongoose.Types.ObjectId(),
  clientId: new mongoose.Types.ObjectId(),
  serverId: new mongoose.Types.ObjectId(),
  networkNodeId: new mongoose.Types.ObjectId(),
  planId: new mongoose.Types.ObjectId(),
});

test('cliente legado com um PPPoE continua válido', () => {
  const ref = ids();
  const client = new Client({
    tenantId: ref.tenantId,
    fullName: 'Cliente Único',
    document: '52998224725',
    planId: ref.planId,
    monthlyPrice: 80,
    access: { authType: 'pppoe', username: 'cliente.unico', password: 'senha' },
    status: 'pending',
  });
  assert.equal(client.validateSync(), undefined);
});

test('mesmo cliente aceita dois ClientAccess com planos diferentes', () => {
  const ref = ids();
  const first = new ClientAccess({ ...ref, username: 'acesso.um', password: 'senha-a', source: 'import' });
  const second = new ClientAccess({
    ...ref,
    planId: new mongoose.Types.ObjectId(),
    username: 'acesso.dois',
    password: 'senha-b',
    source: 'import',
  });
  assert.equal(first.validateSync(), undefined);
  assert.equal(second.validateSync(), undefined);
  assert.equal(String(first.clientId), String(second.clientId));
  assert.notEqual(String(first.planId), String(second.planId));
});

test('schema possui índice único por tenantId e username', () => {
  const uniqueIndex = ClientAccess.schema.indexes().find(([fields, options]) => (
    fields.tenantId === 1 && fields.username === 1 && options.unique === true
  ));
  assert.ok(uniqueIndex, 'índice único tenantId + username deve existir');
});

test('password fica excluída das consultas por padrão', () => {
  assert.equal(ClientAccess.schema.path('password').options.select, false);
});
