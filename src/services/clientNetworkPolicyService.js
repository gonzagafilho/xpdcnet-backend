/**
 * Política de rede / intenção MikroTik derivada do cadastro (status + confiança).
 *
 * NÃO executa RouterOS, NÃO altera secrets, NÃO monitora tráfego.
 * Serve de base única para futura camada de sync (fila/worker/API MikroTik).
 *
 * Matriz recomendada (intenção lógica — execução técnica em fase posterior):
 *
 * | status     | trust ativo + delinquent     | effectiveAccess (fase atual) |
 * |------------|------------------------------|------------------------------|
 * | active     | —                            | full                         |
 * | pending    | —                            | staging (sem produção)       |
 * | delinquent | sim (until válido)           | at_risk_trusted → sync ensure_identity |
 * | delinquent | não                          | at_risk → sync apply_block (PPPoE disabled) |
 * | blocked    | —                            | deny → sync apply_block      |
 * | disabled   | —                            | deprovision                  |
 * | suspended  | —                            | restricted/pause (legado)    |
 * | cancelled  | —                            | terminate                    |
 *
 * trustRelease não anula «blocked» nem «disabled» — são decisões operacionais explícitas.
 */

const TRUST_MS_SLOP = 60_000; // 1 min tolerância de relógio

function plainFromClient(client) {
  if (!client) return null;
  if (typeof client.toObject === 'function') return client.toObject({ flattenMaps: true });
  return { ...client };
}

function isTrustReleaseActive(trustRelease, now = new Date()) {
  if (!trustRelease || !trustRelease.enabled) return false;
  if (!trustRelease.until) return false;
  const end = new Date(trustRelease.until);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() > now.getTime() - TRUST_MS_SLOP;
}

/**
 * @param {object} client - documento Client (Mongoose ou plain)
 * @returns {object}
 */
exports.resolveNetworkIntent = (client) => {
  const c = plainFromClient(client);
  const now = new Date();
  const status = c.status || 'active';
  const trust = c.trustRelease || {};
  const trustActive = isTrustReleaseActive(trust, now);

  /** @type {'full'|'staging'|'at_risk'|'at_risk_trusted'|'deny'|'deprovision'|'restricted'|'terminate'} */
  let effectiveAccess = 'full';
  const messages = [];

  switch (status) {
    case 'active':
      effectiveAccess = 'full';
      messages.push('Cliente ativo: intenção de serviço normal (sync técnico quando existir).');
      break;
    case 'pending':
      effectiveAccess = 'staging';
      messages.push(
        'Pendente: não tratar como assinante em produção; provisioning real será definido na camada de sync.',
      );
      break;
    case 'delinquent':
      if (trustActive) {
        effectiveAccess = 'at_risk_trusted';
        messages.push(
          'Inadimplente com liberação por confiança ativa (until). Mantém intenção de serviço até expirar — apenas política de cadastro nesta fase.',
        );
      } else {
        effectiveAccess = 'at_risk';
        messages.push(
          'Inadimplente sem liberação por confiança: intenção técnica é bloquear PPPoE no MikroTik quando a sync estiver activa (apply_block).',
        );
      }
      break;
    case 'blocked':
      effectiveAccess = 'deny';
      messages.push(
        'Bloqueado: intenção de negar serviço no MikroTik (apply_block quando a sync estiver activa).',
      );
      break;
    case 'disabled':
      effectiveAccess = 'deprovision';
      messages.push('Desativado: intenção de remover ou arquivar vínculo técnico futuramente.');
      break;
    case 'suspended':
      effectiveAccess = 'restricted';
      messages.push(
        'Suspenso (legado): pausa operacional; mapear como restrição soft até haver perfil dedicado.',
      );
      break;
    case 'cancelled':
      effectiveAccess = 'terminate';
      messages.push('Cancelado: fim de contrato; alinhar a desprovisionar no equipamento quando existir sync.');
      break;
    default:
      effectiveAccess = 'restricted';
      messages.push(`Estado «${status}» sem regra explícita; tratar como restrito até alinhar.`);
  }

  if (trustActive && (status === 'blocked' || status === 'disabled')) {
    messages.push(
      'Nota: liberação por confiança não anula bloqueio/desativação explícitos no cadastro.',
    );
  }

  const mikrotik = c.mikrotik || {};
  const serverLinked = Boolean(mikrotik.serverId);

  return {
    clientId: c._id ? String(c._id) : null,
    status,
    trustRelease: {
      configured: Boolean(trust.enabled),
      active: trustActive,
      until: trust.until || null,
      reason: trust.reason || '',
    },
    effectiveAccess,
    mikrotik: {
      serverLinked,
      serverId: mikrotik.serverId ? String(mikrotik.serverId) : null,
      syncState: mikrotik.sync?.state || 'never',
      lastSyncAttemptAt: mikrotik.sync?.lastAttemptAt || null,
      lastSuccessAt: mikrotik.sync?.lastSuccessAt || null,
      lastErrorMessage: mikrotik.sync?.lastErrorMessage || null,
    },
    /**
     * O que a futura sync deve tentar alcançar (sem executar aqui).
     * @type {'noop'|'ensure_identity'|'apply_service'|'apply_block'|'remove_identity'|'hold'}
     */
    recommendedSyncGoal: (() => {
      if (!serverLinked) return 'noop';
      if (effectiveAccess === 'deny') return 'apply_block';
      /** Inadimplente sem trustRelease activo: mesmo efeito técnico que bloqueio operacional explícito. */
      if (effectiveAccess === 'at_risk') return 'apply_block';
      if (effectiveAccess === 'deprovision' || effectiveAccess === 'terminate') return 'remove_identity';
      if (effectiveAccess === 'staging') return 'hold';
      return 'ensure_identity';
    })(),
    messages,
    execution: {
      routerOsInvoked: false,
      note: 'Apenas resolução de política aqui. RouterOS é invocado pelo worker de sync quando MIKROTIK_SYNC_EXECUTION_MODE=live (ou agente remoto).',
    },
  };
};

exports.isTrustReleaseActive = isTrustReleaseActive;
