const GENERIC_RESULT_FIELDS = [
  'status',
  'score',
  'details',
  'executedAt',
  'durationMs',
  'metadata',
];

const METADATA_FIELDS = [
  'source',
  'version',
  'hostname',
  'collectedAt',
  'sampledAt',
  'executedAt',
  'durationMs',
  'action',
  'kind',
];

const IDENTITY_FIELDS = ['name'];
const RESOURCE_FIELDS = [
  'uptime',
  'version',
  'build-time',
  'factory-software',
  'free-memory',
  'total-memory',
  'cpu',
  'cpu-count',
  'cpu-frequency',
  'cpu-load',
  'free-hdd-space',
  'total-hdd-space',
  'architecture-name',
  'board-name',
  'platform',
  'bad-blocks',
  'write-sect-since-reboot',
  'write-sect-total',
];
const ROUTERBOARD_FIELDS = [
  'routerboard',
  'model',
  'serial-number',
  'current-firmware',
  'upgrade-firmware',
  'factory-firmware',
];
const INTERFACE_FIELDS = [
  '.id',
  'name',
  'default-name',
  'type',
  'mac-address',
  'macAddress',
  'mtu',
  'actual-mtu',
  'running',
  'disabled',
  'rx-byte',
  'tx-byte',
  'rx-bytes',
  'tx-bytes',
  'rxBytes',
  'txBytes',
  'rx-packet',
  'tx-packet',
  'link-downs',
  'last-link-up-time',
  'rx-rate',
  'tx-rate',
  'fp-rx-rate',
  'fp-tx-rate',
  'rxRate',
  'txRate',
  'rxMax',
  'txMax',
  'link-speed',
  'linkSpeed',
  'comment',
];
const PPP_SESSION_FIELDS = [
  '.id',
  'name',
  'username',
  'user',
  'login',
  'service',
  'caller-id',
  'callerId',
  'address',
  'remote-address',
  'remoteAddress',
  'currentIp',
  'uptime',
  'encoding',
  'session-id',
  'radius',
  'limit-bytes-in',
  'limit-bytes-out',
  'rx-byte',
  'tx-byte',
  'rx-bytes',
  'tx-bytes',
  'downloadBytes',
  'uploadBytes',
  'downloadMbps',
  'uploadMbps',
  'rxMbps',
  'txMbps',
  'download_mbps',
  'upload_mbps',
  'rxRateMbps',
  'txRateMbps',
  'rawRate',
  'pingMs',
  'ping',
  'latencyMs',
  'jitterMs',
  'jitter',
  'packetLoss',
  'packetLossPercent',
  'loss',
];
const NEIGHBOR_FIELDS = [
  '.id',
  'interface',
  'address',
  'address4',
  'address6',
  'mac-address',
  'macAddress',
  'identity',
  'platform',
  'version',
  'board',
  'unpack',
  'interface-name',
  'system-description',
  'system-name',
];
const WIREGUARD_PEER_FIELDS = [
  '.id',
  'interface',
  'name',
  'public-key',
  'endpoint-address',
  'endpoint-port',
  'current-endpoint-address',
  'current-endpoint-port',
  'allowed-address',
  'persistent-keepalive',
  'rx',
  'tx',
  'last-handshake',
  'disabled',
  'comment',
];
const DNS_FIELDS = [
  'servers',
  'dynamic-servers',
  'use-doh-server',
  'verify-doh-cert',
  'allow-remote-requests',
  'cache-size',
  'cache-used',
  'cache-max-ttl',
  'max-udp-packet-size',
  'query-server-timeout',
  'query-total-timeout',
  'max-concurrent-queries',
  'max-concurrent-tcp-sessions',
];
const NAT_FIELDS = [
  '.id',
  'chain',
  'action',
  'src-address',
  'dst-address',
  'protocol',
  'src-port',
  'dst-port',
  'in-interface',
  'out-interface',
  'to-addresses',
  'to-ports',
  'comment',
  'disabled',
  'invalid',
  'dynamic',
  'bytes',
  'packets',
];
const SERVICE_FIELDS = [
  '.id',
  'name',
  'port',
  'address',
  'certificate',
  'tls-version',
  'disabled',
  'invalid',
  'vrf',
  'max-sessions',
];
const HISTORY_FIELDS = ['.id', 'time', 'user', 'policy', 'action', 'by', 'via'];
const USER_FIELDS = ['.id', 'name', 'group', 'address', 'last-logged-in', 'disabled', 'comment'];
const LOG_FIELDS = ['.id', 'time', 'topics', 'message'];
const INSPECT_FIELDS = ['exists', 'disabled', 'profile', 'status'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeScalar(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function pickScalars(value, fields) {
  if (!isPlainObject(value)) return {};
  return fields.reduce((safe, field) => {
    if (!Object.prototype.hasOwnProperty.call(value, field)) return safe;
    const scalar = sanitizeScalar(value[field]);
    if (scalar !== undefined) safe[field] = scalar;
    return safe;
  }, {});
}

function sanitizeList(value, fields, max = 500) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => pickScalars(item, fields));
}

function sanitizeMetadata(value) {
  return pickScalars(value, METADATA_FIELDS);
}

function sanitizeDetails(value) {
  return pickScalars(value, [
    'code',
    'message',
    'total',
    'count',
    'online',
    'offline',
    'warning',
    'failed',
  ]);
}

function sanitizeGenericResultData(value) {
  if (!isPlainObject(value)) return null;
  const safe = {};
  for (const field of GENERIC_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    if (field === 'metadata') safe.metadata = sanitizeMetadata(value.metadata);
    else if (field === 'details') safe.details = sanitizeDetails(value.details);
    else {
      const scalar = sanitizeScalar(value[field]);
      if (scalar !== undefined) safe[field] = scalar;
    }
  }
  return safe;
}

function sanitizePppContainer(value) {
  if (Array.isArray(value)) return sanitizeList(value, PPP_SESSION_FIELDS);
  if (!isPlainObject(value)) return null;

  for (const wrapper of ['raw', 'data', 'resultData', 'result']) {
    if (Object.prototype.hasOwnProperty.call(value, wrapper)) {
      return { [wrapper]: sanitizePppContainer(value[wrapper]) };
    }
  }

  const safe = {};
  if (value.pppActive !== undefined) safe.pppActive = sanitizePppContainer(value.pppActive);
  if (Array.isArray(value.items)) safe.items = sanitizeList(value.items, PPP_SESSION_FIELDS);
  if (Array.isArray(value.sessions)) safe.sessions = sanitizeList(value.sessions, PPP_SESSION_FIELDS);
  if (Array.isArray(value.activePppSessions)) safe.activePppSessions = sanitizeList(value.activePppSessions, PPP_SESSION_FIELDS);
  if (Array.isArray(value.pppActiveSessions)) safe.pppActiveSessions = sanitizeList(value.pppActiveSessions, PPP_SESSION_FIELDS);
  for (const field of ['total', 'activePppSessionsTotal', 'pppActiveTotal', 'truncated']) {
    const scalar = sanitizeScalar(value[field]);
    if (scalar !== undefined) safe[field] = scalar;
  }
  return safe;
}

function sanitizeSnapshot(value) {
  if (Array.isArray(value)) return sanitizeList(value, PPP_SESSION_FIELDS);
  if (!isPlainObject(value)) return null;

  for (const wrapper of ['raw', 'data', 'resultData', 'result']) {
    if (Object.prototype.hasOwnProperty.call(value, wrapper)) {
      return { [wrapper]: sanitizeSnapshot(value[wrapper]) };
    }
  }

  const safe = {};
  if (value.identity !== undefined) {
    safe.identity = Array.isArray(value.identity)
      ? sanitizeList(value.identity, IDENTITY_FIELDS, 1)
      : pickScalars(value.identity, IDENTITY_FIELDS);
  }
  if (value.resource !== undefined) {
    safe.resource = Array.isArray(value.resource)
      ? sanitizeList(value.resource, RESOURCE_FIELDS, 1)
      : pickScalars(value.resource, RESOURCE_FIELDS);
  }
  if (value.routerboard !== undefined) {
    safe.routerboard = Array.isArray(value.routerboard)
      ? sanitizeList(value.routerboard, ROUTERBOARD_FIELDS, 1)
      : pickScalars(value.routerboard, ROUTERBOARD_FIELDS);
  }
  if (Array.isArray(value.interfaces)) safe.interfaces = sanitizeList(value.interfaces, INTERFACE_FIELDS);
  if (value.pppActive !== undefined) safe.pppActive = sanitizePppContainer(value.pppActive);
  if (Array.isArray(value.activePppSessions)) safe.activePppSessions = sanitizeList(value.activePppSessions, PPP_SESSION_FIELDS);
  if (Array.isArray(value.pppActiveSessions)) safe.pppActiveSessions = sanitizeList(value.pppActiveSessions, PPP_SESSION_FIELDS);
  if (Array.isArray(value.sessions)) safe.sessions = sanitizeList(value.sessions, PPP_SESSION_FIELDS);
  if (Array.isArray(value.items)) safe.items = sanitizeList(value.items, PPP_SESSION_FIELDS);

  for (const field of ['pppSecretCount', 'pppActiveTotal', 'activePppSessionsTotal', 'total', 'truncated']) {
    const scalar = sanitizeScalar(value[field]);
    if (scalar !== undefined) safe[field] = scalar;
  }

  if (value.dns !== undefined) safe.dns = pickScalars(value.dns, DNS_FIELDS);
  if (Array.isArray(value.firewallNat)) safe.firewallNat = sanitizeList(value.firewallNat, NAT_FIELDS, 200);
  if (Array.isArray(value.routerServices)) safe.routerServices = sanitizeList(value.routerServices, SERVICE_FIELDS, 50);
  if (Array.isArray(value.routerHistory)) safe.routerHistory = sanitizeList(value.routerHistory, HISTORY_FIELDS, 80);
  if (Array.isArray(value.routerUsers)) safe.routerUsers = sanitizeList(value.routerUsers, USER_FIELDS, 80);
  if (Array.isArray(value.routerLogs)) safe.routerLogs = sanitizeList(value.routerLogs, LOG_FIELDS, 120);
  if (value.metadata !== undefined) safe.metadata = sanitizeMetadata(value.metadata);

  return safe;
}

function sanitizeNetworkConcentratorTest(value) {
  if (!isPlainObject(value)) return null;
  const allowedStatuses = new Set(['online', 'offline', 'auth_error', 'timeout', 'unsupported', 'unknown']);
  const status = allowedStatuses.has(String(value.status || '')) ? String(value.status) : 'unknown';
  const latency = Number(value.latencyMs);
  const pppoeActiveCount = Number(value.pppoeActiveCount);
  return {
    status,
    latencyMs: Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : null,
    pppoeActiveCount: Number.isFinite(pppoeActiveCount) && pppoeActiveCount >= 0
      ? Math.round(pppoeActiveCount)
      : null,
    systemIdentity: value.systemIdentity != null ? String(value.systemIdentity).slice(0, 120) : null,
  };
}

function sanitizeRemoteAgentResultData(kind, value) {
  if (value == null) return null;

  switch (kind) {
    case 'NETWORK_CONCENTRATOR_TEST':
      return sanitizeNetworkConcentratorTest(value);
    case 'READ_INTERFACE_DISCOVERY':
    case 'READ_INTERFACES':
      return sanitizeList(value, INTERFACE_FIELDS);
    case 'READ_PPP_ACTIVE':
      return sanitizePppContainer(value);
    case 'READ_IDENTITY':
      return Array.isArray(value) ? sanitizeList(value, IDENTITY_FIELDS, 1) : pickScalars(value, IDENTITY_FIELDS);
    case 'READ_RESOURCE':
      return value.identity || value.resource || value.interfaces || value.pppActive
        ? sanitizeSnapshot(value)
        : (Array.isArray(value) ? sanitizeList(value, RESOURCE_FIELDS, 1) : pickScalars(value, RESOURCE_FIELDS));
    case 'READ_NEIGHBORS':
      return sanitizeList(value, NEIGHBOR_FIELDS);
    case 'READ_WIREGUARD_PEERS':
      return sanitizeList(value, WIREGUARD_PEER_FIELDS);
    case 'SERVER_SNAPSHOT':
    case 'SERVER_SNAPSHOT_DETAIL':
      return sanitizeSnapshot(value);
    case 'MONITORING_INSPECT':
      if (isPlainObject(value) && isPlainObject(value.actual)) {
        return { actual: pickScalars(value.actual, INSPECT_FIELDS) };
      }
      return pickScalars(value, INSPECT_FIELDS);
    default:
      return sanitizeGenericResultData(value);
  }
}

module.exports = {
  sanitizeRemoteAgentResultData,
  whitelists: {
    generic: GENERIC_RESULT_FIELDS,
    metadata: METADATA_FIELDS,
    identity: IDENTITY_FIELDS,
    resource: RESOURCE_FIELDS,
    routerboard: ROUTERBOARD_FIELDS,
    interface: INTERFACE_FIELDS,
    pppSession: PPP_SESSION_FIELDS,
    neighbor: NEIGHBOR_FIELDS,
    wireguardPeer: WIREGUARD_PEER_FIELDS,
  },
};
