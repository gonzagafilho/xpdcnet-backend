/**
 * Agente remoto outbound: corre na filial, chama a matriz por HTTPS (saída), obtém comandos e executa RouterOS localmente.
 *
 * Variáveis:
 * - XPDCNET_AGENT_CENTRAL_BASE (ex.: https://matriz.exemplo.com)
 * - XPDCNET_AGENT_NODE_ID (ObjectId do NetworkNode)
 * - XPDCNET_AGENT_TOKEN (token mostrado na criação do node)
 * - XPDCNET_AGENT_POLL_MS (default 5000)
 * - AGENT_ROUTEROS_TIMEOUT_MS (default 25000)
 *
 * Execução: npm run agent:remote
 */

require('dotenv').config();

const { withMikrotikConnection } = require('../integrations/mikrotik/mikrotikClient');
const executor = require('../integrations/mikrotik/mikrotikExecutor');

const LOG = '[xpdcnet-remote-agent]';

const BASE = String(process.env.XPDCNET_AGENT_CENTRAL_BASE || '').replace(/\/$/, '');
const NODE_ID = String(process.env.XPDCNET_AGENT_NODE_ID || '').trim();
const TOKEN = String(process.env.XPDCNET_AGENT_TOKEN || '').trim();
const POLL_MS = Math.max(2_000, Number(process.env.XPDCNET_AGENT_POLL_MS) || 5000);
const ROUTER_TIMEOUT_MS = Math.min(
  120_000,
  Math.max(5_000, Number(process.env.AGENT_ROUTEROS_TIMEOUT_MS) || 25_000),
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(method, path, body) {
  if (typeof fetch !== 'function') {
    throw new Error('Este agente requer Node.js 18+ (fetch nativo).');
  }
  const url = `${BASE}${path}`;
  const headers = {
    'X-XPDCNET-NODE-ID': NODE_ID,
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json',
  };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }
  return { status: res.status, data };
}

async function executeServerSnapshotPayload(payload, variant) {
  const ra = payload && payload.routerApi;
  if (!ra) {
    return {
      success: false,
      error: 'INVALID_PAYLOAD',
      message: 'SERVER_SNAPSHOT: routerApi em falta.',
    };
  }
  const serverLike = {
    host: ra.host,
    port: Number(ra.port) || 8728,
    username: ra.username,
    password: ra.password,
  };
  try {
    return await withMikrotikConnection(serverLike, { timeoutMs: ROUTER_TIMEOUT_MS }, async (api) => {
      const raw =
        variant === 'detail'
          ? await executor.fetchOperationalSnapshotDetail(api)
          : await executor.fetchOperationalSnapshot(api);
      return {
        success: true,
        action: variant === 'detail' ? 'snapshot_detail' : 'snapshot',
        message: JSON.stringify({ raw }),
      };
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return { success: false, error: 'ROUTEROS_EXCEPTION', message: msg.slice(0, 2000) };
  }
}

async function executeMonitoringInspectPayload(payload) {
  const ra = payload && payload.routerApi;
  const pppUser =
    payload && payload.pppUsername != null
      ? String(payload.pppUsername).trim()
      : payload && payload.pppoe && payload.pppoe.username != null
        ? String(payload.pppoe.username).trim()
        : '';
  if (!ra || !pppUser) {
    return { success: false, error: 'INVALID_PAYLOAD', message: 'MONITORING_INSPECT: routerApi ou utilizador PPPoE em falta.' };
  }

  const serverLike = {
    host: ra.host,
    port: Number(ra.port) || 8728,
    username: ra.username,
    password: ra.password,
  };

  try {
    return await withMikrotikConnection(serverLike, { timeoutMs: ROUTER_TIMEOUT_MS }, async (api) => {
      const actual = await executor.inspectPppSecretByName(api, pppUser);
      return {
        success: true,
        action: 'inspect',
        message: JSON.stringify({ actual }),
      };
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return { success: false, error: 'ROUTEROS_EXCEPTION', message: msg.slice(0, 2000) };
  }
}

async function executeSyncIntentPayload(payload) {
  const goal = payload && payload.goal;
  const ra = payload && payload.routerApi;
  const ppp = payload && payload.pppoe;
  const profile =
    payload && payload.profile != null && String(payload.profile).trim()
      ? String(payload.profile).trim()
      : 'default';

  if (!ra || !ppp || !goal) {
    return { success: false, error: 'INVALID_PAYLOAD', message: 'Payload incompleto.' };
  }

  const serverLike = {
    host: ra.host,
    port: Number(ra.port) || 8728,
    username: ra.username,
    password: ra.password,
  };

  try {
    return await withMikrotikConnection(serverLike, { timeoutMs: ROUTER_TIMEOUT_MS }, async (api) => {
      if (goal === 'ensure_identity') {
        const op = await executor.ensurePppoeSecret(api, {
          name: ppp.username,
          password: ppp.password,
          profile,
          disabled: false,
        });
        const action = op === 'created' ? 'create' : 'update';
        return {
          success: true,
          action,
          message: op === 'created' ? 'PPPoE criado no equipamento local.' : 'PPPoE actualizado no equipamento local.',
        };
      }
      if (goal === 'apply_block') {
        const st = await executor.disablePppoeByName(api, ppp.username);
        if (st === 'absent') {
          return { success: true, action: 'disable', message: 'Secret ausente; bloqueio já efectivo.' };
        }
        return { success: true, action: 'disable', message: 'Secret desactivado (disabled=yes).' };
      }
      if (goal === 'remove_identity') {
        const st = await executor.removePppoeByName(api, ppp.username);
        return {
          success: true,
          action: 'remove',
          message: st === 'absent' ? 'Secret não existia; idempotente.' : 'Secret removido.',
        };
      }
      return { success: false, error: 'UNKNOWN_GOAL', message: String(goal) };
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return { success: false, error: 'ROUTEROS_EXCEPTION', message: msg.slice(0, 2000) };
  }
}

async function heartbeat() {
  const hostname = require('os').hostname();
  const { status, data } = await httpJson('POST', '/agent/v1/heartbeat', {
    hostname,
    pid: process.pid,
  });
  if (status >= 300) {
    console.warn(`${LOG} heartbeat HTTP %s %s`, status, typeof data === 'string' ? data : JSON.stringify(data));
  }
}

async function processOneCommand(cmd) {
  const id = cmd && cmd._id;
  const payload = cmd && cmd.payload;
  const kind = payload && payload.kind;
  if (!id || !payload || !kind) {
    if (id) {
      await httpJson('POST', `/agent/v1/commands/${id}/complete`, {
        success: false,
        error: 'UNSUPPORTED_COMMAND',
        message: 'Tipo de comando não suportado pelo agente.',
      });
    }
    return;
  }

  let outcome;
  if (kind === 'SYNC_INTENT') {
    outcome = await executeSyncIntentPayload(payload);
  } else if (kind === 'MONITORING_INSPECT') {
    outcome = await executeMonitoringInspectPayload(payload);
  } else if (kind === 'SERVER_SNAPSHOT') {
    outcome = await executeServerSnapshotPayload(payload, 'summary');
  } else if (kind === 'SERVER_SNAPSHOT_DETAIL') {
    outcome = await executeServerSnapshotPayload(payload, 'detail');
  } else {
    outcome = { success: false, error: 'UNSUPPORTED_COMMAND', message: String(kind) };
  }

  await httpJson('POST', `/agent/v1/commands/${id}/complete`, {
    success: outcome.success,
    action: outcome.action,
    message: outcome.message,
    error: outcome.error,
  });
}

async function main() {
  if (!BASE || !NODE_ID || !TOKEN) {
    console.error(
      `${LOG} Defina XPDCNET_AGENT_CENTRAL_BASE, XPDCNET_AGENT_NODE_ID e XPDCNET_AGENT_TOKEN.`,
    );
    process.exit(1);
  }

  console.log(
    `${LOG} a correr poll=%dms central=%s node=%s`,
    POLL_MS,
    BASE,
    NODE_ID,
  );

  let running = true;
  const stop = () => {
    running = false;
    console.log(`${LOG} paragem solicitada`);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (running) {
    try {
      await heartbeat();
      const { status, data } = await httpJson('GET', '/agent/v1/commands/next', undefined);
      if (status === 204 || !data || !data._id) {
        await sleep(POLL_MS);
        continue;
      }
      if (status >= 300) {
        console.warn(`${LOG} commands/next HTTP %s %s`, status, JSON.stringify(data));
        await sleep(POLL_MS);
        continue;
      }
      console.log(
        `${LOG} comando %s (%s)`,
        data._id,
        data.kind || (data.payload && data.payload.kind) || '—',
      );
      await processOneCommand(data);
    } catch (e) {
      console.error(`${LOG} erro no ciclo: %s`, e && e.message ? e.message : e);
      await sleep(POLL_MS);
    }
    if (!running) break;
    await sleep(250);
  }
}

main().catch((e) => {
  console.error(`${LOG} fatal: %s`, e && e.message ? e.message : e);
  process.exit(1);
});
