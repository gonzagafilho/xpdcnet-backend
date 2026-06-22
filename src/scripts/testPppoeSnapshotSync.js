require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const { syncMikrotikPppoeSnapshotsForConcentrator } = require('../services/pppoeSnapshotService');

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

async function main() {
  const concentratorId = String(argValue('concentratorId')).trim();
  if (!mongoose.Types.ObjectId.isValid(concentratorId)) {
    throw new Error('Use --concentratorId=<ObjectId>.');
  }

  const ok = await connectDB();
  if (!ok) throw new Error('MongoDB nao conectado');

  const concentrator = await NetworkConcentrator.findOne({
    _id: concentratorId,
    enabled: true,
    type: 'mikrotik',
    protocol: 'routeros',
  }).select('+passwordEncrypted').lean();
  if (!concentrator) throw new Error('Concentrador habilitado nao encontrado.');

  const result = await syncMikrotikPppoeSnapshotsForConcentrator(concentrator);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('[testPppoeSnapshotSync] falha:', err?.message || 'Erro desconhecido');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
