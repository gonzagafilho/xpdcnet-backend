const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('./dataImportParserService');
const dataImportService = require('./dataImportService');

test('CSV modelo gera preview normalizado sem gravar', () => {
  const csv = [
    'nome,cpf_cnpj,whatsapp,plano,login_pppoe,senha_pppoe',
    'Maria Silva,52998224725,61999999999,600 Mega,maria.pppoe,segredo',
  ].join('\n');
  const parsed = parser.parseUpload({ originalFilename: 'clientes.csv', contentText: csv });
  const row = parser.normalizeRecord(parsed.rows[0], parser.normalizeMapping(parsed.headers));
  assert.equal(row.fullName, 'Maria Silva');
  assert.equal(row.document, '52998224725');
  assert.equal(row.pppoeUsername, 'maria.pppoe');
});

test('detecção automática reconhece aliases comuns', () => {
  const headers = ['cliente', 'cnpj', 'telefone', 'usuario_pppoe', 'senha_pppoe'];
  assert.deepEqual(parser.detectColumnMapping(headers), {
    cliente: 'fullName', cnpj: 'document', telefone: 'phone',
    usuario_pppoe: 'pppoeUsername', senha_pppoe: 'pppoePassword',
  });
});

test('validação classifica duplicidade de documento e PPPoE', () => {
  const rows = [
    { rowNumber: 2, fullName: 'Cliente A', document: '52998224725', plan: '600 Mega', pppoeUsername: 'cliente.a', pppoePassword: 'senha' },
    { rowNumber: 3, fullName: 'Cliente B', document: '52998224725', plan: '600 Mega', pppoeUsername: 'cliente.a', pppoePassword: 'senha' },
  ];
  const report = dataImportService._test.validateRows(rows, {
    planByName: new Map([['600_mega', { _id: 'plan-id', name: '600 Mega', price: 99.9, authType: 'pppoe', mikrotik: {} }]]),
    existingDocuments: new Set(), existingUsernames: new Set(), livePppoe: new Set(),
  });
  assert.equal(report.report.validRows, 1);
  assert.equal(report.report.duplicateRows, 1);
});

test('modelo CSV contém todas as colunas oficiais', () => {
  const template = dataImportService.csvTemplate();
  for (const column of dataImportService._test.TEMPLATE_COLUMNS) assert.equal(template.includes(column), true);
});
