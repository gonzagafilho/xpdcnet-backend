require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');

mongoose.set('autoIndex', false);

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tenantId = String(argValue('tenantId')).trim();
  const concentratorId = String(argValue('concentratorId')).trim();
  if (!tenantId) throw new Error('Use --tenantId=<tenantId>.');
  if (!mongoose.Types.ObjectId.isValid(concentratorId)) throw new Error('Use --concentratorId=<ObjectId>.');

  const ok = await connectDB();
  if (!ok) throw new Error('MongoDB nao conectado.');

  const concentrator = await NetworkConcentrator.findOne({ _id: concentratorId, tenantId }).lean();
  if (!concentrator) throw new Error('Concentrador nao encontrado para o tenant informado.');

  const legacyFilter = {
    tenantId,
    $or: [
      { concentratorId: null },
      { concentratorId: { $exists: false } },
      { concentratorName: null },
      { concentratorName: { $exists: false } },
      { agentNodeId: null },
      { agentNodeId: { $exists: false } },
    ],
  };
  const legacyRows = await PppoeLiveSnapshot.countDocuments(legacyFilter);
  const indexes = await PppoeLiveSnapshot.collection.indexes().catch(() => []);
  const legacyIndex = indexes.find((index) => (
    index.unique === true
    && index.key?.tenantId === 1
    && index.key?.pppoeUsername === 1
    && Object.keys(index.key).length === 2
  ));
  const expectedIndex = indexes.find((index) => (
    index.unique === true
    && index.key?.tenantId === 1
    && index.key?.concentratorId === 1
    && index.key?.pppoeUsername === 1
    && Object.keys(index.key).length === 3
  ));

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    tenantId,
    concentratorId,
    concentratorName: concentrator.name,
    agentNodeId: String(concentrator.agentNodeId),
    legacyRows,
    legacyIndex: legacyIndex?.name || null,
    expectedIndex: expectedIndex?.name || null,
  }, null, 2));

  if (!apply) return;

  if (legacyRows > 0) {
    await PppoeLiveSnapshot.updateMany(legacyFilter, {
      $set: {
        concentratorId: concentrator._id,
        concentratorName: concentrator.name,
        agentNodeId: concentrator.agentNodeId,
      },
    });
  }
  if (legacyIndex?.name) await PppoeLiveSnapshot.collection.dropIndex(legacyIndex.name);
  await PppoeLiveSnapshot.collection.createIndex(
    { tenantId: 1, concentratorId: 1, pppoeUsername: 1 },
    { unique: true, name: 'tenantId_1_concentratorId_1_pppoeUsername_1' },
  );

  console.log(JSON.stringify({ ok: true, migratedRows: legacyRows }, null, 2));
}

main()
  .catch((err) => {
    console.error('[migratePppoeSnapshotConcentratorIndex] falha:', err?.message || 'Erro desconhecido');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
