require('dotenv').config();

const BASE = String(process.env.XPDCNET_AGENT_CENTRAL_BASE || '').replace(/\/$/, '');
const NODE_ID = String(process.env.XPDCNET_AGENT_NODE_ID || '').trim();
const TOKEN = String(process.env.XPDCNET_AGENT_TOKEN || '').trim();

const payload = {
  sessions: [
    {
      username: 'cliente_lab_01',
      currentIp: '100.64.0.10',
      uptime: '1h10m',
      service: 'pppoe',
      callerId: 'lab',
      downloadBytes: 1000000,
      uploadBytes: 500000,
    },
  ],
};

async function main() {
  if (!BASE) throw new Error('XPDCNET_AGENT_CENTRAL_BASE nao configurado.');
  if (!NODE_ID) throw new Error('XPDCNET_AGENT_NODE_ID nao configurado.');
  if (!TOKEN) throw new Error('XPDCNET_AGENT_TOKEN nao configurado.');
  if (typeof fetch !== 'function') throw new Error('Node.js 18+ requerido para fetch nativo.');

  const response = await fetch(`${BASE}/agent/v1/pppoe/snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-XPDCNET-NODE-ID': NODE_ID,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { message: text.slice(0, 500) };
    }
  }

  console.log(JSON.stringify({
    status: response.status,
    ok: response.ok,
    response: data,
  }, null, 2));

  if (!response.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[testAgentPppoeSnapshotEndpoint] falha:', err && err.message ? err.message : 'Erro desconhecido');
  process.exitCode = 1;
});
