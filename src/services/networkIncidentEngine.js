const NetworkIncident = require('../models/NetworkIncident');
const NetworkNode = require('../models/NetworkNode');
const { calculateNodeHealthScore } = require('./networkHealthScoreService');

function buildFingerprint({ tenantId, nodeId, type, key = 'node' }) {
  return `${tenantId}:${nodeId}:${type}:${key}`;
}

async function openOrTouchIncident({
  tenantId,
  nodeId,
  type,
  severity = 'warning',
  title,
  message,
  key = 'node',
  metadata = {},
}) {
  const now = new Date();
  const fingerprint = buildFingerprint({ tenantId, nodeId, type, key });

  const existing = await NetworkIncident.findOne({
    tenantId,
    nodeId,
    fingerprint,
    status: 'open',
  });

  if (existing) {
    existing.lastSeenAt = now;
    existing.severity = severity;
    existing.message = message || existing.message;
    existing.metadata = {
      ...(existing.metadata || {}),
      ...metadata,
      lastTouchedAt: now,
    };
    await existing.save();
    return existing;
  }

  return NetworkIncident.create({
    tenantId,
    nodeId,
    type,
    severity,
    status: 'open',
    title,
    message,
    startedAt: now,
    lastSeenAt: now,
    fingerprint,
    source: 'incident-engine',
    metadata,
  });
}

async function resolveOpenIncidents({
  tenantId,
  nodeId,
  types = [],
  message = 'Incidente resolvido automaticamente.',
  metadata = {},
}) {
  if (!types.length) return { modifiedCount: 0 };

  const now = new Date();

  return NetworkIncident.updateMany(
    {
      tenantId,
      nodeId,
      type: { $in: types },
      status: 'open',
    },
    {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        lastSeenAt: now,
        message,
        metadata: {
          ...metadata,
          resolvedBy: 'incident-engine',
          resolvedAt: now,
        },
      },
    },
  );
}

async function evaluateHeartbeat({ node, metric, meta }) {
  if (!node || !metric) return;

  const tenantId = String(node.tenantId);
  const nodeId = String(node._id);

  const status = String(meta?.status || metric.status || 'online');
  const mikrotik = meta?.mikrotik && typeof meta.mikrotik === 'object'
    ? meta.mikrotik
    : {};

  const health = meta?.health && typeof meta.health === 'object'
    ? meta.health
    : {};

  const cpuLoad = Number(metric.cpuLoad || 0);
  const pppOnlineCount = Number(metric.pppOnlineCount || 0);
  const totalRxMbps = Number(metric.totalRxMbps || 0);
  const totalTxMbps = Number(metric.totalTxMbps || 0);

  const dns = mikrotik && typeof mikrotik.dns === 'object' ? mikrotik.dns : null;

  if (dns) {
    const dnsServers = dns.servers != null ? String(dns.servers).trim() : '';

    const allowRemoteRequests =
      dns['allow-remote-requests'] === true ||
      dns['allow-remote-requests'] === 'true' ||
      dns.allowRemoteRequests === true ||
      dns.allowRemoteRequests === 'true';

    if (allowRemoteRequests) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'DNS_OPEN_RESOLVER',
        severity: 'critical',
        key: 'dns',
        title: 'DNS aberto para consultas remotas',
        message: 'O RouterOS está com allow-remote-requests ativo. Verificar firewall para evitar abuso de DNS aberto.',
        metadata: {
          dnsServers,
          allowRemoteRequests,
          detection: 'routeros_dns_allow_remote_requests',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['DNS_OPEN_RESOLVER'],
        message: 'DNS remoto não está mais aberto.',
        metadata: {
          dnsServers,
          allowRemoteRequests,
        },
      });
    }

    if (!dnsServers) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'DNS_EMPTY',
        severity: 'warning',
        key: 'dns',
        title: 'DNS não configurado',
        message: 'Nenhum servidor DNS foi encontrado na configuração do RouterOS.',
        metadata: {
          dnsServers,
          detection: 'routeros_dns_empty',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['DNS_EMPTY'],
        message: 'DNS voltou a ter servidores configurados.',
        metadata: {
          dnsServers,
        },
      });
    }

    const publicExternalDns =
      dnsServers.includes('8.8.8.8') ||
      dnsServers.includes('8.8.4.4') ||
      dnsServers.includes('1.1.1.1') ||
      dnsServers.includes('1.0.0.1');

    if (publicExternalDns) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'DNS_EXTERNAL_PUBLIC',
        severity: 'info',
        key: 'dns',
        title: 'DNS público externo detectado',
        message: `DNS público externo detectado no RouterOS: ${dnsServers}. Confirmar se é configuração autorizada.`,
        metadata: {
          dnsServers,
          detection: 'routeros_dns_public_external',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['DNS_EXTERNAL_PUBLIC'],
        message: 'DNS público externo não detectado na leitura atual.',
        metadata: {
          dnsServers,
        },
      });
    }
  }

  const firewallNat = Array.isArray(mikrotik.firewallNat)
    ? mikrotik.firewallNat
    : [];

  if (firewallNat.length > 0) {
    const enabledNatRules = firewallNat.filter((rule) => {
      return !(rule.disabled === true || rule.disabled === 'true' || rule.disabled === 'yes');
    });

    const masqueradeRules = enabledNatRules.filter((rule) => {
      return String(rule.action || '').toLowerCase() === 'masquerade';
    });

    const dstNatRules = enabledNatRules.filter((rule) => {
      return String(rule.chain || '').toLowerCase() === 'dstnat';
    });

    const exposedPortForwards = dstNatRules.filter((rule) => {
      const inInterface = String(rule['in-interface'] || rule.inInterface || '').toLowerCase();
      const protocol = String(rule.protocol || '').toLowerCase();
      const dstPort = String(rule['dst-port'] || rule.dstPort || '').trim();
      return dstPort && (protocol === 'tcp' || protocol === 'udp' || protocol === '');
    });

    const disabledRules = firewallNat.filter((rule) => {
      return rule.disabled === true || rule.disabled === 'true' || rule.disabled === 'yes';
    });

    if (masqueradeRules.length === 0) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'NAT_MASQUERADE_MISSING',
        severity: 'critical',
        key: 'nat',
        title: 'NAT masquerade ausente',
        message: 'Nenhuma regra ativa de masquerade foi encontrada. Clientes podem ficar sem navegação.',
        metadata: {
          totalRules: firewallNat.length,
          enabledRules: enabledNatRules.length,
          detection: 'routeros_nat_no_active_masquerade',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['NAT_MASQUERADE_MISSING'],
        message: 'Regra de masquerade ativa encontrada.',
        metadata: {
          masqueradeCount: masqueradeRules.length,
        },
      });
    }

    if (masqueradeRules.length > 2) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'NAT_DUPLICATED_MASQUERADE',
        severity: 'warning',
        key: 'nat',
        title: 'Múltiplas regras de masquerade',
        message: `Foram encontradas ${masqueradeRules.length} regras ativas de masquerade. Verificar duplicidade ou conflito.`,
        metadata: {
          masqueradeCount: masqueradeRules.length,
          detection: 'routeros_nat_many_masquerade_rules',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['NAT_DUPLICATED_MASQUERADE'],
        message: 'Quantidade de masquerade voltou ao padrão esperado.',
        metadata: {
          masqueradeCount: masqueradeRules.length,
        },
      });
    }

    if (disabledRules.length >= 5) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'NAT_DISABLED_RULES',
        severity: 'info',
        key: 'nat',
        title: 'Muitas regras NAT desativadas',
        message: `Existem ${disabledRules.length} regras NAT desativadas. Recomenda-se revisar limpeza e conflitos.`,
        metadata: {
          disabledRulesCount: disabledRules.length,
          detection: 'routeros_nat_many_disabled_rules',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['NAT_DISABLED_RULES'],
        message: 'Quantidade de regras NAT desativadas dentro do esperado.',
        metadata: {
          disabledRulesCount: disabledRules.length,
        },
      });
    }

    if (exposedPortForwards.length > 0) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'NAT_PORT_FORWARD_EXPOSED',
        severity: 'warning',
        key: 'nat',
        title: 'Port forward exposto detectado',
        message: `Foram detectadas ${exposedPortForwards.length} regras dstnat com portas publicadas. Revisar exposição WAN.`,
        metadata: {
          exposedPortForwardsCount: exposedPortForwards.length,
          samples: exposedPortForwards.slice(0, 5).map((rule) => ({
            comment: rule.comment || '',
            protocol: rule.protocol || '',
            dstPort: rule['dst-port'] || rule.dstPort || '',
            toAddresses: rule['to-addresses'] || rule.toAddresses || '',
            toPorts: rule['to-ports'] || rule.toPorts || '',
          })),
          detection: 'routeros_nat_dstnat_port_forward',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['NAT_PORT_FORWARD_EXPOSED'],
        message: 'Nenhum port forward exposto detectado na leitura atual.',
        metadata: {
          exposedPortForwardsCount: 0,
        },
      });
    }
  }

  const routerServices = Array.isArray(mikrotik.routerServices)
    ? mikrotik.routerServices
    : [];

  if (routerServices.length > 0) {
    const enabledServices = routerServices.filter((service) => {
      return !(
        service.disabled === true ||
        service.disabled === 'true' ||
        service.disabled === 'yes'
      );
    });

    const criticalServices = [
      {
        name: 'telnet',
        type: 'SERVICE_TELNET_ENABLED',
        severity: 'critical',
      },
      {
        name: 'ftp',
        type: 'SERVICE_FTP_ENABLED',
        severity: 'critical',
      },
      {
        name: 'api',
        type: 'SERVICE_API_EXPOSED',
        severity: 'critical',
      },
      {
        name: 'api-ssl',
        type: 'SERVICE_API_SSL_EXPOSED',
        severity: 'warning',
      },
      {
        name: 'ssh',
        type: 'SERVICE_SSH_EXPOSED',
        severity: 'warning',
      },
      {
        name: 'winbox',
        type: 'SERVICE_WINBOX_EXPOSED',
        severity: 'warning',
      },
      {
        name: 'www',
        type: 'SERVICE_WWW_EXPOSED',
        severity: 'warning',
      },
    ];

    for (const definition of criticalServices) {
      const found = enabledServices.find((service) => {
        return (
          String(service.name || '').toLowerCase() === definition.name
        );
      });

      if (found) {
        await openOrTouchIncident({
          tenantId,
          nodeId,
          type: definition.type,
          severity: definition.severity,
          key: definition.name,
          title: `Serviço exposto: ${definition.name}`,
          message: `O serviço ${definition.name} está habilitado no RouterOS. Verificar exposição WAN e política de acesso.`,
          metadata: {
            service: definition.name,
            port: found.port || '',
            address: found.address || '',
            certificate: found.certificate || '',
            vrf: found.vrf || '',
            detection: 'routeros_service_enabled',
          },
        });
      } else {
        await resolveOpenIncidents({
          tenantId,
          nodeId,
          types: [definition.type],
          message: `Serviço ${definition.name} não está habilitado.`,
          metadata: {
            service: definition.name,
          },
        });
      }
    }
  }

  const routerHistory = Array.isArray(mikrotik.routerHistory)
    ? mikrotik.routerHistory
    : [];

  if (routerHistory.length > 0) {
    const historyText = routerHistory
      .map((row) => {
        return JSON.stringify(row).toLowerCase();
      })
      .join(' ');

    const driftRules = [
      {
        match: ['dns'],
        type: 'CONFIG_DNS_CHANGED',
        severity: 'warning',
        title: 'Alteração DNS detectada',
      },
      {
        match: ['firewall', 'filter'],
        type: 'CONFIG_FIREWALL_CHANGED',
        severity: 'warning',
        title: 'Alteração firewall detectada',
      },
      {
        match: ['nat'],
        type: 'CONFIG_NAT_CHANGED',
        severity: 'warning',
        title: 'Alteração NAT detectada',
      },
      {
        match: ['route'],
        type: 'CONFIG_ROUTE_CHANGED',
        severity: 'warning',
        title: 'Alteração de rota detectada',
      },
      {
        match: ['service'],
        type: 'CONFIG_SERVICE_CHANGED',
        severity: 'warning',
        title: 'Alteração de serviços detectada',
      },
      {
        match: ['user', 'password', 'group'],
        type: 'CONFIG_USER_CHANGED',
        severity: 'critical',
        title: 'Alteração de usuário detectada',
      },
    ];

    for (const rule of driftRules) {
      const matched = rule.match.some((term) => {
        return historyText.includes(term);
      });

      if (matched) {
        await openOrTouchIncident({
          tenantId,
          nodeId,
          type: rule.type,
          severity: rule.severity,
          key: rule.type,
          title: rule.title,
          message: `O XPDCNET detectou possível alteração de configuração relacionada a ${rule.match.join(', ')}.`,
          metadata: {
            detection: 'routeros_config_drift',
            match: rule.match,
            sample: routerHistory.slice(0, 5),
          },
        });
      } else {
        await resolveOpenIncidents({
          tenantId,
          nodeId,
          types: [rule.type],
          message: `Nenhuma alteração recente relacionada a ${rule.match.join(', ')} foi detectada.`,
          metadata: {
            match: rule.match,
          },
        });
      }
    }
  }

  const routerUsers = Array.isArray(mikrotik.routerUsers)
    ? mikrotik.routerUsers
    : [];

  if (routerUsers.length > 0) {
    const enabledUsers = routerUsers.filter((user) => {
      return !(
        user.disabled === true ||
        user.disabled === 'true' ||
        user.disabled === 'yes'
      );
    });

    const fullUsers = enabledUsers.filter((user) => {
      const group = String(user.group || '').toLowerCase();
      return group === 'full' || group.includes('admin');
    });

    if (fullUsers.length >= 3) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'ROUTER_MULTIPLE_FULL_USERS',
        severity: 'critical',
        key: 'router_admins',
        title: 'Múltiplos usuários administrativos',
        message: `O RouterOS possui ${fullUsers.length} usuários administrativos ativos.`,
        metadata: {
          totalAdmins: fullUsers.length,
          users: fullUsers.map((u) => ({
            name: u.name || '',
            group: u.group || '',
            address: u.address || '',
          })),
          detection: 'multiple_full_users',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['ROUTER_MULTIPLE_FULL_USERS'],
        message: 'Quantidade de usuários administrativos voltou ao normal.',
        metadata: {
          totalAdmins: fullUsers.length,
        },
      });
    }

    for (const user of fullUsers) {
      const hasAddressRestriction =
        user.address != null &&
        String(user.address).trim() !== '';

      if (!hasAddressRestriction) {
        await openOrTouchIncident({
          tenantId,
          nodeId,
          type: 'ROUTER_USER_WITHOUT_ADDRESS_LIMIT',
          severity: 'warning',
          key: user.name || 'unknown',
          title: `Usuário sem restrição IP: ${user.name || 'unknown'}`,
          message: `O usuário ${user.name || 'unknown'} não possui restrição de address no RouterOS.`,
          metadata: {
            user: user.name || '',
            group: user.group || '',
            address: user.address || '',
            detection: 'router_user_without_address_limit',
          },
        });
      } else {
        await resolveOpenIncidents({
          tenantId,
          nodeId,
          types: ['ROUTER_USER_WITHOUT_ADDRESS_LIMIT'],
          message: `Usuário ${user.name || 'unknown'} possui restrição de IP.`,
          metadata: {
            user: user.name || '',
            address: user.address || '',
          },
        });
      }
    }

    const guestUsers = enabledUsers.filter((user) => {
      const name = String(user.name || '').toLowerCase();
      return (
        name.includes('guest') ||
        name.includes('teste') ||
        name.includes('test')
      );
    });

    for (const guest of guestUsers) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'ROUTER_GUEST_USER_ENABLED',
        severity: 'warning',
        key: guest.name || 'guest',
        title: `Usuário temporário habilitado: ${guest.name || 'guest'}`,
        message: `Usuário potencialmente temporário/teste está habilitado no RouterOS.`,
        metadata: {
          user: guest.name || '',
          group: guest.group || '',
          detection: 'guest_or_test_user_enabled',
        },
      });
    }

    if (guestUsers.length === 0) {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['ROUTER_GUEST_USER_ENABLED'],
        message: 'Nenhum usuário guest/teste habilitado detectado.',
        metadata: {},
      });
    }
  }

  const routerLogs = Array.isArray(mikrotik.routerLogs)
    ? mikrotik.routerLogs
    : [];

  if (routerLogs.length > 0) {
    const authLogs = routerLogs.filter((log) => {
      const line = JSON.stringify(log).toLowerCase();

      return (
        line.includes('login failure') ||
        line.includes('authentication failed') ||
        line.includes('invalid user') ||
        line.includes('logged in fail') ||
        line.includes('failure')
      );
    });

    if (authLogs.length > 0) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'AUTH_FAILURE_DETECTED',
        severity: 'warning',
        key: 'auth_failure',
        title: 'Falhas de autenticação detectadas',
        message: `O XPDCNET detectou ${authLogs.length} falhas de autenticação recentes no RouterOS.`,
        metadata: {
          totalFailures: authLogs.length,
          detection: 'routeros_auth_failure',
          sample: authLogs.slice(0, 10),
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['AUTH_FAILURE_DETECTED'],
        message: 'Nenhuma falha de autenticação recente detectada.',
        metadata: {},
      });
    }

    if (authLogs.length >= 5) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'AUTH_FAILURE_BURST',
        severity: 'critical',
        key: 'auth_burst',
        title: 'Possível bruteforce detectado',
        message: `O XPDCNET detectou ${authLogs.length} falhas de autenticação no mesmo snapshot.`,
        metadata: {
          totalFailures: authLogs.length,
          threshold: 5,
          detection: 'routeros_auth_failure_burst',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['AUTH_FAILURE_BURST'],
        message: 'Volume de falhas de autenticação voltou ao normal.',
        metadata: {
          totalFailures: authLogs.length,
        },
      });
    }

    const sshFailures = authLogs.filter((log) => {
      return JSON.stringify(log).toLowerCase().includes('ssh');
    });

    if (sshFailures.length > 0) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'AUTH_SSH_FAILURE',
        severity: 'warning',
        key: 'ssh_failures',
        title: 'Falhas SSH detectadas',
        message: `O XPDCNET detectou ${sshFailures.length} falhas SSH no RouterOS.`,
        metadata: {
          totalFailures: sshFailures.length,
          detection: 'routeros_ssh_failure',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['AUTH_SSH_FAILURE'],
        message: 'Nenhuma falha SSH detectada.',
        metadata: {},
      });
    }

    const apiFailures = authLogs.filter((log) => {
      const line = JSON.stringify(log).toLowerCase();

      return (
        line.includes('api') ||
        line.includes('api-ssl')
      );
    });

    if (apiFailures.length > 0) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'AUTH_API_FAILURE',
        severity: 'critical',
        key: 'api_failures',
        title: 'Falhas API detectadas',
        message: `O XPDCNET detectou ${apiFailures.length} falhas de autenticação API.`,
        metadata: {
          totalFailures: apiFailures.length,
          detection: 'routeros_api_failure',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['AUTH_API_FAILURE'],
        message: 'Nenhuma falha API detectada.',
        metadata: {},
      });
    }

    const winboxFailures = authLogs.filter((log) => {
      return JSON.stringify(log).toLowerCase().includes('winbox');
    });

    if (winboxFailures.length > 0) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'AUTH_WINBOX_FAILURE',
        severity: 'warning',
        key: 'winbox_failures',
        title: 'Falhas Winbox detectadas',
        message: `O XPDCNET detectou ${winboxFailures.length} falhas Winbox.`,
        metadata: {
          totalFailures: winboxFailures.length,
          detection: 'routeros_winbox_failure',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['AUTH_WINBOX_FAILURE'],
        message: 'Nenhuma falha Winbox detectada.',
        metadata: {},
      });
    }
  }

  if (status === 'degraded' || mikrotik.online === false || health.ok === false) {
    await openOrTouchIncident({
      tenantId,
      nodeId,
      type: 'MIKROTIK_DEGRADED',
      severity: 'warning',
      title: 'MikroTik degradada',
      message: 'Agent online, mas a coleta da MikroTik reportou falha ou estado degradado.',
      metadata: {
        status,
        errors: Array.isArray(health.errors) ? health.errors : [],
        mikrotikOnline: mikrotik.online,
      },
    });
  } else {
    await resolveOpenIncidents({
      tenantId,
      nodeId,
      types: ['MIKROTIK_DEGRADED', 'MIKROTIK_OFFLINE'],
      message: 'MikroTik voltou ao estado online.',
      metadata: { recoveredFromHeartbeat: true },
    });
  }

  if (cpuLoad >= 95) {
    await openOrTouchIncident({
      tenantId,
      nodeId,
      type: 'HIGH_CPU',
      severity: 'critical',
      title: 'CPU crítica na MikroTik',
      message: `CPU da MikroTik em ${cpuLoad}%.`,
      metadata: { cpuLoad },
    });
  } else if (cpuLoad >= 85) {
    await openOrTouchIncident({
      tenantId,
      nodeId,
      type: 'HIGH_CPU',
      severity: 'warning',
      title: 'CPU alta na MikroTik',
      message: `CPU da MikroTik em ${cpuLoad}%.`,
      metadata: { cpuLoad },
    });
  } else {
    await resolveOpenIncidents({
      tenantId,
      nodeId,
      types: ['HIGH_CPU'],
      message: 'CPU da MikroTik voltou ao normal.',
      metadata: { cpuLoad },
    });
  }

  const interfaces = Array.isArray(metric.interfaces) ? metric.interfaces : [];

  for (const item of interfaces) {
    const name = item.name || 'unknown';
    const normalizedName = String(name).toLowerCase();

    const isCriticalLink =
      normalizedName.includes('wan') ||
      normalizedName.includes('link') ||
      normalizedName.includes('uplink') ||
      normalizedName.includes('backbone') ||
      normalizedName.includes('ptp') ||
      normalizedName.includes('pop') ||
      normalizedName.includes('sfp') ||
      normalizedName === 'ether1' ||
      normalizedName === 'pppoe-out1';

    const isDown = item.disabled !== true && item.running === false;
    const rxMbps = Number(item.rxMbps || 0);
    const txMbps = Number(item.txMbps || 0);
    const linkMbps = Math.max(rxMbps, txMbps);

    if (!isDown && isCriticalLink && linkMbps >= 900) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'LINK_SATURATED',
        severity: 'warning',
        key: name,
        title: `Link próximo da saturação: ${name}`,
        message: `O link ${name} atingiu ${Math.round(linkMbps)} Mbps. Verificar capacidade, gargalo ou necessidade de upgrade.`,
        metadata: {
          interface: name,
          rxMbps,
          txMbps,
          linkMbps,
          thresholdMbps: 900,
          detection: 'critical_link_high_throughput',
        },
      });
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['LINK_SATURATED'],
        message: `Link ${name} saiu da zona de saturação.`,
        metadata: {
          interface: name,
          rxMbps,
          txMbps,
          linkMbps,
        },
      });
    }

    if (isDown) {
      await openOrTouchIncident({
        tenantId,
        nodeId,
        type: 'INTERFACE_DOWN',
        severity: isCriticalLink ? 'critical' : 'warning',
        key: name,
        title: isCriticalLink ? `Queda de link em ${name}` : `Interface ${name} sem link`,
        message: isCriticalLink
          ? `Link crítico ${name} caiu ou perdeu carrier.`
          : `A interface ${name} está habilitada, mas não está running.`,
        metadata: {
          interface: name,
          running: item.running,
          disabled: item.disabled,
          isCriticalLink,
          transitionDetectedAt: new Date(),
        },
      });

      const flapWindowMs = 2 * 60 * 1000;

      const recentTransitions = await NetworkIncident.countDocuments({
        tenantId,
        nodeId,
        type: 'LINK_DOWN',
        'metadata.interface': name,
        createdAt: {
          $gte: new Date(Date.now() - flapWindowMs),
        },
      });

      if (isCriticalLink && recentTransitions >= 3) {
        await openOrTouchIncident({
          tenantId,
          nodeId,
          type: 'LINK_FLAPPING',
          severity: 'warning',
          key: name,
          title: `Link instável detectado: ${name}`,
          message: `O link ${name} apresentou múltiplas oscilações em curto período.`,
          metadata: {
            interface: name,
            recentTransitions,
            flapWindowMs,
            detection: 'repeated_link_transitions',
          },
        });
      }

      if (isCriticalLink) {
        await openOrTouchIncident({
          tenantId,
          nodeId,
          type: 'LINK_DOWN',
          severity: 'critical',
          key: name,
          title: `Link crítico fora: ${name}`,
          message: `O link crítico ${name} está fora. Verificar fibra, rádio, porta, SFP, energia ou upstream.`,
          metadata: {
            interface: name,
            running: item.running,
            disabled: item.disabled,
            detection: 'interface_not_running',
          },
        });
      }
    } else {
      await resolveOpenIncidents({
        tenantId,
        nodeId,
        types: ['INTERFACE_DOWN', 'LINK_DOWN'],
        message: `Interface ${name} voltou ao normal.`,
        metadata: { interface: name },
      });
    }
  }

  const openIncidentsForScore = await NetworkIncident.find({
    tenantId,
    nodeId,
    status: 'open',
  })
    .select('type severity metadata')
    .lean();

  const nodeHealthScore = calculateNodeHealthScore({
    node,
    metric,
    openIncidents: openIncidentsForScore,
  });

  await NetworkNode.updateOne(
    { _id: nodeId },
    {
      $set: {
        healthScore: nodeHealthScore.score,
        healthLevel: nodeHealthScore.level,
        healthUpdatedAt: new Date(),
        healthReasons: nodeHealthScore.reasons,
      },
    }
  );

  if (pppOnlineCount === 0 && (totalRxMbps > 5 || totalTxMbps > 5)) {
    await openOrTouchIncident({
      tenantId,
      nodeId,
      type: 'PPPOE_ZERO_WITH_TRAFFIC',
      severity: 'info',
      title: 'Tráfego sem PPPoE online',
      message: 'Existe tráfego relevante, mas nenhum PPPoE online foi reportado.',
      metadata: {
        pppOnlineCount,
        totalRxMbps,
        totalTxMbps,
      },
    });
  } else {
    await resolveOpenIncidents({
      tenantId,
      nodeId,
      types: ['PPPOE_ZERO_WITH_TRAFFIC'],
      message: 'Condição de tráfego sem PPPoE não está mais ativa.',
      metadata: {
        pppOnlineCount,
        totalRxMbps,
        totalTxMbps,
      },
    });
  }
}

module.exports = {
  buildFingerprint,
  openOrTouchIncident,
  resolveOpenIncidents,
  evaluateHeartbeat,
};
