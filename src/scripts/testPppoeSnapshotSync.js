require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { syncMikrotikPppoeSnapshots } = require('../services/pppoeSnapshotService');

async function main() {
  const ok = await connectDB();
  if (!ok) throw new Error('MongoDB nao conectado');

  const result = await syncMikrotikPppoeSnapshots();
  console.log(JSON.stringify({
    online: result.online,
    offlineMarked: result.offlineMarked,
    totalRead: result.totalRead,
    syncedAt: result.syncedAt,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error('[testPppoeSnapshotSync] falha:', err && err.message ? err.message : 'Erro desconhecido');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
