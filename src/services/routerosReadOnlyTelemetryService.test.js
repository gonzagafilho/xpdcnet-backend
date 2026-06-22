const test = require('node:test');
const assert = require('node:assert/strict');
const {
  READ_ONLY_COMMANDS,
  collectRouterosReadOnlyTelemetry,
} = require('./routerosReadOnlyTelemetryService');

test('telemetria executa somente comandos RouterOS print permitidos', async () => {
  const commands = [];
  const api = {
    write: async (command) => {
      commands.push(command);
      if (command === '/system/resource/print') return [{ 'cpu-load': '12', version: '7.23' }];
      if (command === '/interface/print') return [{ name: 'ether1', running: 'true', disabled: 'false' }];
      if (command === '/system/health/print') return [{ temperature: '44', voltage: '24.1' }];
      return [];
    },
  };

  const result = await collectRouterosReadOnlyTelemetry(api);

  assert.deepEqual(commands, READ_ONLY_COMMANDS);
  assert.equal(result.resource.version, '7.23');
  assert.equal(result.interfaces[0].running, true);
  assert.equal(result.health.temperature, '44');
  assert.equal(commands.some((command) => /\/(set|add|remove|enable|disable)$/.test(command)), false);
});
