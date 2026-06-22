const READ_ONLY_COMMANDS = Object.freeze([
  '/system/resource/print',
  '/interface/print',
  '/system/health/print',
]);

function rosBoolean(value) {
  return value === true || value === 'true' || value === 'yes';
}

function mapInterface(row = {}) {
  return {
    name: row.name != null ? String(row.name).trim() : '',
    type: row.type != null ? String(row.type).trim() : '',
    running: rosBoolean(row.running),
    disabled: rosBoolean(row.disabled),
    rxBytes: row['rx-byte'] != null ? String(row['rx-byte']) : (row['rx-bytes'] != null ? String(row['rx-bytes']) : null),
    txBytes: row['tx-byte'] != null ? String(row['tx-byte']) : (row['tx-bytes'] != null ? String(row['tx-bytes']) : null),
    rxBitsPerSecond: row['rx-bits-per-second'] != null ? String(row['rx-bits-per-second']) : null,
    txBitsPerSecond: row['tx-bits-per-second'] != null ? String(row['tx-bits-per-second']) : null,
  };
}

async function safePrint(api, command) {
  try {
    const rows = await api.write(command, []);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function collectRouterosReadOnlyTelemetry(api) {
  if (!api || typeof api.write !== 'function') throw new Error('Conexão RouterOS ausente para telemetria.');

  const resourceRows = await safePrint(api, READ_ONLY_COMMANDS[0]);
  const interfaceRows = await safePrint(api, READ_ONLY_COMMANDS[1]);
  const healthRows = await safePrint(api, READ_ONLY_COMMANDS[2]);

  return {
    resource: resourceRows[0] || null,
    interfaces: interfaceRows.slice(0, 96).map(mapInterface),
    health: healthRows[0] || null,
  };
}

module.exports = {
  READ_ONLY_COMMANDS,
  collectRouterosReadOnlyTelemetry,
  mapInterface,
};
