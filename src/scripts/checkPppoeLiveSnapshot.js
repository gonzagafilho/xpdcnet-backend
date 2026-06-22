require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

async function main() {
  const tenantId = String(argValue('tenantId') || process.env.PPPOE_CHECK_TENANT_ID || process.env.PPPOE_DEFAULT_TENANT_ID || 'tenant_lab').trim();
  const concentratorId = String(argValue('concentratorId') || process.env.PPPOE_CHECK_CONCENTRATOR_ID || '').trim();
  const pppoeUsername = String(argValue('username') || process.env.PPPOE_CHECK_USERNAME || 'cliente_lab_01').trim().toLowerCase();

  if (!tenantId) throw new Error('tenantId ausente.');
  if (!mongoose.Types.ObjectId.isValid(concentratorId)) throw new Error('concentratorId ausente ou invalido.');
  if (!pppoeUsername) throw new Error('pppoeUsername ausente.');

  const ok = await connectDB();
  if (!ok) throw new Error('MongoDB nao conectado.');

  const row = await PppoeLiveSnapshot.findOne({ tenantId, concentratorId, pppoeUsername })
    .select('tenantId concentratorId concentratorName agentNodeId pppoeUsername status currentIp uptime source lastUpdateAt')
    .lean();

  console.log(JSON.stringify(row ? {
    tenantId: row.tenantId,
    concentratorId: String(row.concentratorId),
    concentratorName: row.concentratorName,
    agentNodeId: String(row.agentNodeId),
    pppoeUsername: row.pppoeUsername,
    status: row.status,
    currentIp: row.currentIp,
    uptime: row.uptime,
    source: row.source,
    lastUpdateAt: row.lastUpdateAt,
  } : null, null, 2));
}

main()
  .catch((err) => {
    console.error('[checkPppoeLiveSnapshot] falha:', err && err.message ? err.message : 'Erro desconhecido');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
