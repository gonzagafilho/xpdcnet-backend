const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('./monitoringConcentratorService');

test('health score aplica penalidades sem ficar negativo', () => {
  const score = _private.healthScore({
    status: 'online', cpuPercent: 95, memoryPercent: 96,
    interfaceTotal: 10, interfaceRunning: 5, pppOnline: 0, telemetryAt: null,
  });
  assert.equal(score, 10);
  assert.equal(_private.healthLabel(score), 'critical');
});

test('summary preserva PPP e não expõe credenciais', () => {
  const item = _private.mapSummary(
    {
      _id: '6a3943cb145eb430820aee21', name: 'CHACARA STARLINK', type: 'mikrotik',
      protocol: 'routeros', host: '10.201.201.10', port: 8728, enabled: true,
      status: 'online', username: 'nao-expor', passwordEncrypted: 'nao-expor',
    },
    {
      cpuPercent: 12, memoryPercent: 30, interfaceTotal: 10, interfaceRunning: 10,
      pppOnline: 31, version: '7.23', uptime: '1d', createdAt: new Date(),
    },
    { online: 31, offline: 3 },
  );
  assert.equal(item.pppTotal, 34);
  assert.equal(item.pppOnline, 31);
  assert.equal(item.pppOffline, 3);
  assert.equal(item.username, undefined);
  assert.equal(item.passwordEncrypted, undefined);
});


const { _private: alertPrivate } = require('./concentratorAlertService');

const TENANT_ID = '6a3943cb145eb430820aee20';
const CONCENTRATOR_ID = '6a3943cb145eb430820aee21';
const NOW = new Date('2026-06-22T18:00:00.000Z');

function alertSummary(overrides = {}) {
  return {
    id: CONCENTRATOR_ID,
    name: 'CHACARA STARLINK',
    status: 'online',
    cpuPercent: 20,
    memoryPercent: 30,
    telemetryAt: new Date(NOW.getTime() - 60_000),
    healthScore: 100,
    ...overrides,
  };
}

function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => String(row[key]) === String(value));
}

function fakeAlertModel() {
  const rows = [];
  return {
    rows,
    async updateMany(filter, update) {
      const found = rows.filter((row) => matches(row, filter));
      found.forEach((row) => Object.assign(row, update.$set || {}));
      return { modifiedCount: found.length };
    },
    async findOneAndUpdate(filter, update, options = {}) {
      let row = rows.find((item) => matches(item, filter));
      if (!row && options.upsert) {
        row = { _id: String(rows.length + 1), ...(update.$setOnInsert || {}) };
        rows.push(row);
      }
      if (row) Object.assign(row, update.$set || {});
      return row;
    },
    find(filter) {
      let result = rows.filter((row) => matches(row, filter));
      const query = {
        sort() { return query; },
        limit(value) { result = result.slice(0, value); return query; },
        async lean() { return result.map((row) => ({ ...row })); },
      };
      return query;
    },
  };
}

test('alertas classificam CPU warning e critical', () => {
  const warning = alertPrivate.evaluateConditions(alertSummary({ cpuPercent: 85 }), NOW);
  const critical = alertPrivate.evaluateConditions(alertSummary({ cpuPercent: 95 }), NOW);
  assert.equal(warning.CPU_HIGH.severity, 'warning');
  assert.equal(warning.CPU_HIGH.thresholdValue, 80);
  assert.equal(critical.CPU_HIGH.severity, 'critical');
  assert.equal(critical.CPU_HIGH.thresholdValue, 90);
});

test('alertas classificam RAM critical, offline e telemetria stale', () => {
  const conditions = alertPrivate.evaluateConditions(alertSummary({
    memoryPercent: 91,
    status: 'offline',
    telemetryAt: new Date(NOW.getTime() - 11 * 60_000),
  }), NOW);
  assert.equal(conditions.RAM_HIGH.severity, 'critical');
  assert.equal(conditions.OFFLINE.severity, 'critical');
  assert.equal(conditions.TELEMETRY_STALE.severity, 'critical');
});

test('telemetria ausente gera alerta stale', () => {
  const conditions = alertPrivate.evaluateConditions(alertSummary({ telemetryAt: null }), NOW);
  assert.equal(conditions.TELEMETRY_STALE.severity, 'critical');
  assert.equal(conditions.TELEMETRY_STALE.metricValue, null);
});

test('avaliação não duplica alerta aberto e atualiza severidade', async () => {
  const model = fakeAlertModel();
  const service = alertPrivate.createService(model);
  await service.evaluateConcentratorAlerts(TENANT_ID, alertSummary({ cpuPercent: 85 }), { now: NOW });
  await service.evaluateConcentratorAlerts(TENANT_ID, alertSummary({ cpuPercent: 95 }), { now: NOW });
  const cpuAlerts = model.rows.filter((row) => row.type === 'CPU_HIGH' && row.status === 'open');
  assert.equal(cpuAlerts.length, 1);
  assert.equal(cpuAlerts[0].severity, 'critical');
});

test('avaliação resolve automaticamente quando condição normaliza', async () => {
  const model = fakeAlertModel();
  const service = alertPrivate.createService(model);
  await service.evaluateConcentratorAlerts(TENANT_ID, alertSummary({ memoryPercent: 95 }), { now: NOW });
  await service.evaluateConcentratorAlerts(TENANT_ID, alertSummary({ memoryPercent: 40 }), { now: NOW });
  const ramAlert = model.rows.find((row) => row.type === 'RAM_HIGH');
  assert.equal(ramAlert.status, 'resolved');
  assert.equal(ramAlert.resolvedAt.toISOString(), NOW.toISOString());
});
