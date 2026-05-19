/**
 * Traduz a intenção de rede (output de resolveNetworkIntent) em chamadas ao executor.
 * Carrega credenciais do equipamento via modelo MikrotikServer.
 *
 * exporta applySyncIntent (live) e dryRunApplySyncIntent (sem socket RouterOS).
 */

const mongoose = require('mongoose');
const MikrotikServer = require('../../models/MikrotikServer');
const { withMikrotikConnection, scrubSecretsFromMessage } = require('./mikrotikClient');
const executor = require('./mikrotikExecutor');
const { decrypt } = require('../../services/encryptionService');
const networkNodeRoutingService = require('../../services/networkNodeRoutingService');
const remoteAgentCommandService = require('../../services/remoteAgentCommandService');

/**
 * @typedef {object} SyncResult
 * @property {boolean} success
 * @property {'create'|'update'|'disable'|'remove'} action
 * @property {string} message
 * @property {string} [error]
 */

/**
 * @param {boolean} success
 * @param {'create'|'update'|'disable'|'remove'} action
 * @param {string} message
 * @param {string} [error]
 * @returns {SyncResult}
 */
function result(success, action, message, error) {
  const r = { success, action, message };
  if (error) r.error = error;
  return r;
}

function plainClient(client) {
  if (!client) return null;
  if (typeof client.toObject === 'function') return client.toObject({ flattenMaps: true });
  return { ...client };
}

/**
 * Perfil PPPoE: campo no cliente; fallback técnico sem consultar plano (sem regra de negócio aqui).
 * @param {object} plain
 */
function resolvePppProfile(plain) {
  const p = plain.mikrotik && plain.mikrotik.profile != null ? String(plain.mikrotik.profile).trim() : '';
  return p || 'default';
}

/**
 * Valida intent + contexto até ao ponto imediatamente antes de abrir ligação RouterOS.
 * @returns {Promise<{ kind: 'syncResult', syncResult: SyncResult } | { kind: 'ready', ... } | { kind: 'remoteAgent', ... }>}
 */
async function prepareSyncExecution(intent, executionContext) {
  const goal = intent && intent.recommendedSyncGoal;

  if (goal === 'noop' || goal === 'hold') {
    return {
      kind: 'syncResult',
      syncResult: result(
        true,
        'update',
        goal === 'hold'
          ? 'Política «hold»: execução RouterOS adiada (staging). Nenhuma chamada ao equipamento.'
          : 'Política «noop»: sem servidor vinculado ou sem operação técnica. Nenhuma chamada ao equipamento.',
      ),
    };
  }

  const plain = plainClient(executionContext && executionContext.client);
  if (!plain) {
    return { kind: 'syncResult', syncResult: result(false, 'update', 'Cliente em falta no contexto de execução.', 'MISSING_CLIENT') };
  }

  if (intent.clientId && plain._id && String(intent.clientId) !== String(plain._id)) {
    return {
      kind: 'syncResult',
      syncResult: result(
        false,
        'update',
        'O intent não corresponde ao cliente fornecido (clientId diferente).',
        'INTENT_CLIENT_MISMATCH',
      ),
    };
  }

  if (String(plain.access?.authType || 'pppoe') !== 'pppoe') {
    return {
      kind: 'syncResult',
      syncResult: result(
        false,
        'update',
        'Executor actual só suporta access.authType «pppoe».',
        'UNSUPPORTED_AUTH_TYPE',
      ),
    };
  }

  const username = plain.access && plain.access.username != null ? String(plain.access.username).trim() : '';
  const password = plain.access && plain.access.password != null ? String(plain.access.password) : '';
  if (!username || !password) {
    return {
      kind: 'syncResult',
      syncResult: result(
        false,
        'create',
        'Credenciais PPPoE incompletas (access.username / access.password).',
        'MISSING_PPPOE_CREDENTIALS',
      ),
    };
  }

  const serverId = intent && intent.mikrotik && intent.mikrotik.serverId ? String(intent.mikrotik.serverId) : null;
  const tid = executionContext.tenantId;
  if (!serverId || !mongoose.Types.ObjectId.isValid(serverId)) {
    return { kind: 'syncResult', syncResult: result(false, 'update', 'Intent sem serverId válido.', 'MISSING_SERVER_ID') };
  }
  if (!tid || !mongoose.Types.ObjectId.isValid(String(tid))) {
    return { kind: 'syncResult', syncResult: result(false, 'update', 'tenantId inválido no contexto.', 'INVALID_TENANT') };
  }

  const serverDoc = await MikrotikServer.findOne({ _id: serverId, tenantId: tid }).lean();
  if (!serverDoc) {
    return {
      kind: 'syncResult',
      syncResult: result(false, 'update', 'Servidor MikroTik não encontrado para este tenant.', 'SERVER_NOT_FOUND'),
    };
  }
  if (serverDoc.isActive === false) {
    return {
      kind: 'syncResult',
      syncResult: result(false, 'update', 'Servidor MikroTik está inactivo no cadastro.', 'SERVER_INACTIVE'),
    };
  }

  const profile = resolvePppProfile(plain);
  let serverPassword = '';
  try {
    serverPassword = decrypt(serverDoc.password != null ? String(serverDoc.password) : '');
  } catch (_) {
    return {
      kind: 'syncResult',
      syncResult: result(
        false,
        'update',
        'Credencial do servidor MikroTik inválida ou não legível no ambiente actual.',
        'SERVER_CREDENTIAL_DECRYPT_FAILED',
      ),
    };
  }

  const serverLike = {
    host: serverDoc.host,
    port: serverDoc.port,
    username: serverDoc.username,
    password: serverPassword,
  };

  const route = await networkNodeRoutingService.resolveExecutionRoute(tid, plain, serverDoc);
  if (route.channel === 'ERROR') {
    return {
      kind: 'syncResult',
      syncResult: result(false, 'update', route.message, route.code),
    };
  }
  if (route.channel === 'REMOTE_AGENT') {
    return {
      kind: 'remoteAgent',
      goal,
      plain,
      username,
      password,
      profile,
      serverLike,
      networkNode: route.networkNode,
      serverId,
    };
  }

  return {
    kind: 'ready',
    goal,
    plain,
    username,
    password,
    profile,
    serverLike,
  };
}

/**
 * @param {object} intent — resultado de resolveNetworkIntent(client)
 * @param {object} executionContext
 * @param {string|mongoose.Types.ObjectId} executionContext.tenantId
 * @param {object} executionContext.client — documento Client (plain ou Mongoose)
 * @param {number} [executionContext.timeoutMs]
 * @returns {Promise<SyncResult>}
 */
async function applySyncIntent(intent, executionContext) {
  const prep = await prepareSyncExecution(intent, executionContext);
  if (prep.kind === 'syncResult') return prep.syncResult;

  if (prep.kind === 'remoteAgent') {
    const tid = executionContext.tenantId;
    const syncJobId = executionContext.syncJobId;
    if (!syncJobId) {
      return result(
        false,
        'update',
        'syncJobId em falta no contexto — actualize o worker mikrotikSyncWorker.',
        'MISSING_SYNC_JOB_ID',
      );
    }
    const payload = {
      kind: 'SYNC_INTENT',
      goal: prep.goal,
      pppoe: { username: prep.username, password: prep.password },
      routerApi: {
        host: prep.serverLike.host,
        port: prep.serverLike.port,
        username: prep.serverLike.username,
        password: prep.serverLike.password,
      },
      profile: prep.profile,
    };
    const r = await remoteAgentCommandService.enqueueSyncIntentCommand({
      tenantId: tid,
      networkNodeId: prep.networkNode._id,
      clientId: prep.plain._id,
      serverId: prep.serverId,
      mikrotikSyncJobId: syncJobId,
      payload,
    });
    const dup = r.duplicate ? ' Comando pendente já existia para este job (idempotência).' : '';
    return result(
      true,
      'update',
      `Sync enfileirada para o agente remoto «${prep.networkNode.name}».${dup}`,
    );
  }

  const { goal, username, password, profile, serverLike } = prep;
  const messages = [];
  const timeoutMs = executionContext.timeoutMs;

  try {
    return await withMikrotikConnection(serverLike, { timeoutMs }, async (api) => {
      if (goal === 'ensure_identity') {
        const op = await executor.ensurePppoeSecret(api, {
          name: username,
          password,
          profile,
          disabled: false,
        });
        const act = op === 'created' ? 'create' : 'update';
        messages.push(
          op === 'created'
            ? `PPPoE secret criado (perfil ${profile}).`
            : `PPPoE secret actualizado (perfil ${profile}).`,
        );
        return result(true, act, messages.join(' '));
      }

      if (goal === 'apply_block') {
        const st = await executor.disablePppoeByName(api, username);
        if (st === 'absent') {
          return result(
            true,
            'disable',
            'Nenhum secret correspondente no equipamento; bloqueio já efectivo ou nunca provisionado.',
          );
        }
        return result(true, 'disable', 'Secret PPPoE desactivado (disabled=yes).');
      }

      if (goal === 'remove_identity') {
        const st = await executor.removePppoeByName(api, username);
        if (st === 'absent') {
          return result(true, 'remove', 'Secret não existia; remoção idempotente concluída.');
        }
        return result(true, 'remove', 'Secret PPPoE removido.');
      }

      return result(false, 'update', `Objectivo de sync não suportado: ${String(goal)}`, 'UNKNOWN_GOAL');
    });
  } catch (err) {
    const detail = scrubSecretsFromMessage(err && err.message ? String(err.message) : String(err));
    return result(
      false,
      'update',
      'Falha ao comunicar com o RouterOS.',
      detail.length > 500 ? `${detail.slice(0, 500)}…` : detail,
    );
  }
}

/**
 * Mesma validação que live; não abre socket. Mensagens sem expor credenciais PPPoE.
 * @param {object} intent
 * @param {object} executionContext
 * @returns {Promise<SyncResult>}
 */
async function dryRunApplySyncIntent(intent, executionContext) {
  const prep = await prepareSyncExecution(intent, executionContext);
  if (prep.kind === 'syncResult') return prep.syncResult;

  if (prep.kind === 'remoteAgent') {
    return result(
      true,
      'update',
      `[dry-run] Encaminharia ao agente remoto «${prep.networkNode.name}» — sem fila e sem RouterOS a partir da matriz.`,
    );
  }

  const { goal, profile } = prep;

  if (goal === 'ensure_identity') {
    return result(
      true,
      'update',
      `[dry-run] Executaria ensure_identity (PPPoE, perfil «${profile}») — sem ligação RouterOS.`,
    );
  }
  if (goal === 'apply_block') {
    return result(
      true,
      'disable',
      '[dry-run] Executaria apply_block (disabled=yes no secret PPPoE) — sem ligação RouterOS.',
    );
  }
  if (goal === 'remove_identity') {
    return result(
      true,
      'remove',
      '[dry-run] Executaria remove_identity (/ppp/secret/remove) — sem ligação RouterOS.',
    );
  }

  return result(false, 'update', `Objectivo de sync não suportado: ${String(goal)}`, 'UNKNOWN_GOAL');
}

module.exports = {
  applySyncIntent,
  dryRunApplySyncIntent,
  result,
};
