const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCustomerAccessPreview } = require('./dataImportCustomerGroupingService');

test('agrupa mesmo CPF em um cliente com dois acessos PPPoE e planos independentes', () => {
  const rows = [
    {
      rowNumber: 2,
      fullName: 'Rusivania de Souza costa',
      document: '03905495333',
      plan: 'DC NET CHÁCARA ESPECIAL',
      pppoeUsername: 'rusivaniachacarra',
      pppoePassword: 'senha-a',
    },
    {
      rowNumber: 3,
      fullName: 'Rusivania de S.costa',
      document: '03905495333',
      plan: 'DC NET CHÁCARA FAZENDA',
      pppoeUsername: 'rusivaniasouza',
      pppoePassword: 'senha-b',
    },
  ];
  const result = groupCustomerAccessPreview(rows, {
    planByName: new Map([
      ['dc_net_chacara_especial', { _id: 'plan-a', name: 'DC NET CHÁCARA ESPECIAL' }],
      ['dc_net_chacara_fazenda', { _id: 'plan-b', name: 'DC NET CHÁCARA FAZENDA' }],
    ]),
    existingDocuments: new Set(),
    existingUsernames: new Set(),
    livePppoe: new Set(['rusivaniachacarra', 'rusivaniasouza']),
  });
  assert.equal(result.report.totalRows, 1);
  assert.equal(result.report.totalAccessRows, 2);
  assert.equal(result.report.validRows, 1);
  assert.equal(result.report.duplicateRows, 0);
  assert.equal(result.report.matchedPppoeRows, 2);
  assert.equal(result.customers[0].accesses.length, 2);
  assert.equal(result.persistence.confirmationBlocked, false);
});
