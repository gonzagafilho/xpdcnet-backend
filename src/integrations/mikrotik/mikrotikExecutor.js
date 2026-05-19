/**
 * Comandos técnicos PPPoE em /ppp/secret (RouterOS).
 * Recebe uma instância já ligada (RouterOSAPI). Sem decisão de negócio.
 *
 * Parâmetros enviados à API seguem o formato node-routeros: '=chave=valor'.
 *
 * Encaminhamento directo vs agente: a escolha do canal (socket na matriz vs fila RemoteAgentCommand)
 * é feita em networkNodeRoutingService + mikrotikAdapter — não neste módulo.
 */

/**
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {string} name
 * @returns {Promise<object|null>} primeira linha ou null
 */
async function findPppSecretByName(api, name) {
  const safeName = String(name || '');
  if (!safeName) return null;
  const rows = await api.write('/ppp/secret/print', [`?name=${safeName}`]);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

function parseRosDisabled(value) {
  if (value === true || value === 'true' || value === 'yes') return true;
  return false;
}

/**
 * Estado do secret no equipamento (somente leitura).
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {string} name
 * @returns {Promise<{ exists: boolean, disabled: boolean, profile: string | null, status: 'active'|'blocked'|'missing' }>}
 */
async function inspectPppSecretByName(api, name) {
  const row = await findPppSecretByName(api, name);
  if (!row) {
    return { exists: false, disabled: false, profile: null, status: 'missing' };
  }
  const disabled = parseRosDisabled(row.disabled);
  const profile = row.profile != null && row.profile !== '' ? String(row.profile) : null;
  return {
    exists: true,
    disabled,
    profile,
    status: disabled ? 'blocked' : 'active',
  };
}

/**
 * Cria secret PPPoE.
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {{ name: string, password: string, profile: string, disabled?: boolean }} params
 */
async function createPppoeSecret(api, { name, password, profile, disabled = false }) {
  await api.write('/ppp/secret/add', [
    `=name=${name}`,
    `=password=${password}`,
    '=service=pppoe',
    `=profile=${profile}`,
    `=disabled=${disabled ? 'yes' : 'no'}`,
  ]);
}

/**
 * Actualiza secret existente (.id RouterOS).
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {{ id: string, password: string, profile: string, disabled: boolean }} params
 */
async function updatePppoeSecret(api, { id, password, profile, disabled }) {
  const fields = [`=.id=${id}`, `=password=${password}`, `=profile=${profile}`, `=disabled=${disabled ? 'yes' : 'no'}`];
  await api.write('/ppp/secret/set', fields);
}

/**
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {string} rosId
 */
async function removePppSecretById(api, rosId) {
  await api.write('/ppp/secret/remove', [`=.id=${rosId}`]);
}

/**
 * Garante identidade PPPoE: cria ou actualiza (perfil, password, disabled).
 * @returns {Promise<'created'|'updated'>}
 */
async function ensurePppoeSecret(api, { name, password, profile, disabled }) {
  const row = await findPppSecretByName(api, name);
  if (!row) {
    await createPppoeSecret(api, { name, password, profile, disabled });
    return 'created';
  }
  const id = row['.id'];
  if (!id) {
    throw new Error('Resposta RouterOS sem .id para secret existente.');
  }
  await updatePppoeSecret(api, { id, password, profile, disabled });
  return 'updated';
}

/**
 * Desactiva secret por nome (disabled=yes). Se não existir, não falha.
 * @returns {Promise<'disabled'|'absent'>}
 */
async function disablePppoeByName(api, name) {
  const row = await findPppSecretByName(api, name);
  if (!row || !row['.id']) return 'absent';
  await api.write('/ppp/secret/set', [`=.id=${row['.id']}`, '=disabled=yes']);
  return 'disabled';
}

/**
 * @returns {Promise<'enabled'|'absent'>}
 */
async function enablePppoeByName(api, name) {
  const row = await findPppSecretByName(api, name);
  if (!row || !row['.id']) return 'absent';
  await api.write('/ppp/secret/set', [`=.id=${row['.id']}`, '=disabled=no']);
  return 'enabled';
}

/**
 * Remove secret por nome.
 * @returns {Promise<'removed'|'absent'>}
 */
async function removePppoeByName(api, name) {
  const row = await findPppSecretByName(api, name);
  if (!row || !row['.id']) return 'absent';
  await removePppSecretById(api, row['.id']);
  return 'removed';
}

/**
 * Primeira linha de um comando /print (RouterOS).
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {string} path — ex. `/system/resource`
 */
async function printFirstRow(api, path) {
  const rows = await api.write(`${path}/print`, []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function rosBoolYes(value) {
  return value === 'true' || value === true || value === 'yes';
}

/**
 * Contagem de sessões em /ppp/active (sem mapear linhas — uma ida à API).
 * @param {import('node-routeros').RouterOSAPI} api
 * @returns {Promise<number|null>}
 */
async function fetchPppActiveSessionCount(api) {
  try {
    const rows = await api.write('/ppp/active/print', []);
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_) {
    return null;
  }
}

/**
 * Snapshot operacional mínimo (identidade, recurso, routerboard, interfaces em execução, contagem PPP).
 * Falhas parciais não interrompem o restante.
 * @param {import('node-routeros').RouterOSAPI} api
 */
async function fetchOperationalSnapshot(api) {
  const identity = await printFirstRow(api, '/system/identity');
  const resource = await printFirstRow(api, '/system/resource');
  let routerboard = null;
  try {
    routerboard = await printFirstRow(api, '/system/routerboard');
  } catch (_) {
    /* intencional */
  }
  let interfaces = [];
  try {
    const ifrows = await api.write('/interface/print', []);
    if (Array.isArray(ifrows)) {
      interfaces = ifrows
        .filter((r) => rosBoolYes(r.running))
        .slice(0, 12)
        .map((r) => ({
          name: r.name != null ? String(r.name).trim() : '',
          running: true,
          disabled: false,
          rxBytes: r['rx-byte'] != null ? String(r['rx-byte']) : undefined,
          txBytes: r['tx-byte'] != null ? String(r['tx-byte']) : undefined,
        }));
    }
  } catch (_) {
    /* intencional */
  }
  let pppSecretCount = null;
  try {
    const secrets = await api.write('/ppp/secret/print', []);
    pppSecretCount = Array.isArray(secrets) ? secrets.length : null;
  } catch (_) {
    /* intencional */
  }
  const pppActiveTotal = await fetchPppActiveSessionCount(api);
  return { identity, resource, routerboard, interfaces, pppSecretCount, pppActiveTotal };
}

function firstNonEmptyStr(row, keys) {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/**
 * Linha de interface para vista detalhada (NOC). Campos opcionais dependem da versão RouterOS.
 * @param {object} r
 */
function mapInterfaceRowDetailed(r) {
  const rxB = r['rx-byte'] != null ? String(r['rx-byte']) : null;
  const txB = r['tx-byte'] != null ? String(r['tx-byte']) : null;
  const rxRate = firstNonEmptyStr(r, ['rx-rate', 'fp-rx-rate']);
  const txRate = firstNonEmptyStr(r, ['tx-rate', 'fp-tx-rate']);
  return {
    name: r.name != null ? String(r.name).trim() : '',
    running: rosBoolYes(r.running),
    disabled: rosBoolYes(r.disabled),
    rx: rxB,
    tx: txB,
    rxBytes: rxB,
    txBytes: txB,
    rxRate: rxRate || null,
    txRate: txRate || null,
    rxMax: firstNonEmptyStr(r, ['link-speed', 'max-limit']) || rxRate || null,
    txMax: txRate || null,
    comment: r.comment != null && String(r.comment).trim() ? String(r.comment).trim() : null,
    type: r.type != null ? String(r.type) : null,
    macAddress: firstNonEmptyStr(r, ['mac-address', 'macAddress']),
    mtu: r.mtu != null && String(r.mtu).trim() ? String(r.mtu) : r['actual-mtu'] != null ? String(r['actual-mtu']) : null,
    linkSpeed: firstNonEmptyStr(r, ['link-speed', 'speed']),
  };
}

const PPP_ACTIVE_LIMIT_DEFAULT = 80;

/**
 * Sessões PPP activas (/ppp/active/print). Limite de linhas na resposta API.
 * @param {import('node-routeros').RouterOSAPI} api
 * @param {number} [limit]
 * @returns {Promise<{ items: object[], total: number, truncated: boolean }>}
 */
async function fetchPppActiveSessions(api, limit = PPP_ACTIVE_LIMIT_DEFAULT) {
  const cap = Math.min(100, Math.max(1, Number(limit) || PPP_ACTIVE_LIMIT_DEFAULT));
  try {
    const rows = await api.write('/ppp/active/print', []);
    if (!Array.isArray(rows)) {
      return { items: [], total: 0, truncated: false };
    }
    const total = rows.length;
    const slice = rows.slice(0, cap);
    const items = slice.map((row) => ({
      name: row.name != null ? String(row.name) : '',
      service: row.service != null ? String(row.service) : '',
      callerId: row['caller-id'] != null ? String(row['caller-id']) : row.callerId != null ? String(row.callerId) : '',
      address: row.address != null ? String(row.address) : '',
      uptime: row.uptime != null ? String(row.uptime) : '',
      encoding: row.encoding != null ? String(row.encoding) : '',
      sessionId: row['.id'] != null ? String(row['.id']) : row['session-id'] != null ? String(row['session-id']) : '',
      radius: row.radius != null && String(row.radius).trim() ? String(row.radius) : '',
      limitBytesIn: firstNonEmptyStr(row, ['limit-bytes-in', 'limitBytesIn']) || '',
      limitBytesOut: firstNonEmptyStr(row, ['limit-bytes-out', 'limitBytesOut']) || '',
      localAddress: firstNonEmptyStr(row, ['local-address', 'localAddress']) || '',
      remoteAddress: firstNonEmptyStr(row, ['remote-address', 'remoteAddress']) || '',
      profile: row.profile != null ? String(row.profile) : '',
      server: row.server != null ? String(row.server) : firstNonEmptyStr(row, ['via']) || '',
    }));
    return { items, total, truncated: total > cap };
  } catch (_) {
    return { items: [], total: 0, truncated: false };
  }
}

/**
 * Snapshot alargado: todas as interfaces (limite 96) com metadados para painel NOC.
 * @param {import('node-routeros').RouterOSAPI} api
 */
async function fetchOperationalSnapshotDetail(api) {
  const identity = await printFirstRow(api, '/system/identity');
  const resource = await printFirstRow(api, '/system/resource');
  let routerboard = null;
  try {
    routerboard = await printFirstRow(api, '/system/routerboard');
  } catch (_) {
    /* intencional */
  }
  let interfaces = [];
  try {
    const ifrows = await api.write('/interface/print', []);
    if (Array.isArray(ifrows)) {
      interfaces = ifrows.slice(0, 96).map((r) => mapInterfaceRowDetailed(r));
    }
  } catch (_) {
    /* intencional */
  }
  let pppSecretCount = null;
  try {
    const secrets = await api.write('/ppp/secret/print', []);
    pppSecretCount = Array.isArray(secrets) ? secrets.length : null;
  } catch (_) {
    /* intencional */
  }
  const pppActive = await fetchPppActiveSessions(api, PPP_ACTIVE_LIMIT_DEFAULT);
  return { identity, resource, routerboard, interfaces, pppSecretCount, pppActive };
}

module.exports = {
  findPppSecretByName,
  inspectPppSecretByName,
  createPppoeSecret,
  updatePppoeSecret,
  removePppSecretById,
  ensurePppoeSecret,
  disablePppoeByName,
  enablePppoeByName,
  removePppoeByName,
  printFirstRow,
  fetchOperationalSnapshot,
  fetchOperationalSnapshotDetail,
  fetchPppActiveSessions,
  fetchPppActiveSessionCount,
};
