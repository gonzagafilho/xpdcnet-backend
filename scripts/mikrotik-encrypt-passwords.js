#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const MikrotikServer = require('../src/models/MikrotikServer');
const { encrypt, isEncrypted } = require('../src/services/encryptionService');

async function main() {
  const ok = await connectDB();
  if (!ok) {
    console.error('[mikrotik-encrypt-passwords] MongoDB indisponível');
    return 1;
  }

  const { hydrateMikrotikSecretFromDatabase } = require('../src/services/encryptionService');
  await hydrateMikrotikSecretFromDatabase();

  const rows = await MikrotikServer.find({}).select('_id password').lean();
  let converted = 0;
  let skipped = 0;

  for (const row of rows) {
    const raw = row.password != null ? String(row.password) : '';
    if (isEncrypted(raw)) {
      skipped += 1;
      continue;
    }
    const encrypted = encrypt(raw);
    await MikrotikServer.updateOne({ _id: row._id }, { $set: { password: encrypted } });
    converted += 1;
  }

  console.log(
    '[mikrotik-encrypt-passwords] done total=%d converted=%d skipped=%d',
    rows.length,
    converted,
    skipped,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[mikrotik-encrypt-passwords] erro:', err && err.message ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
