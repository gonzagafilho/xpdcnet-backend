#!/usr/bin/env node
/**
 * Migração one-shot: encripta campos sensíveis em BillingAccount.credentials já existentes.
 * Chaves: modo legado (BILLING_SECRET_KEY / MIKROTIK_SECRET_KEY) ou modo anel
 * (BILLING_SECRET_KEYS_JSON + BILLING_SECRET_ACTIVE_KEY_ID) — ver encryptionService.js.
 */
require('dotenv').config();

const connectDB = require('../src/config/db');
const BillingAccount = require('../src/models/billing/BillingAccount');
const billingCredentialsCrypto = require('../src/services/billing/billingCredentialsCrypto');

async function main() {
  const ok = await connectDB();
  if (!ok) {
    console.error('[billing-encrypt-credentials] MongoDB indisponível');
    return 1;
  }

  const rows = await BillingAccount.find({}).select('_id credentials').lean();
  let converted = 0;
  let skipped = 0;

  for (const row of rows) {
    const cred = row.credentials;
    if (!cred || typeof cred !== 'object') {
      skipped += 1;
      continue;
    }
    if (!billingCredentialsCrypto.credentialsContainSecrets(cred)) {
      skipped += 1;
      continue;
    }
    const enc = billingCredentialsCrypto.encryptCredentialsForStorage(cred);
    let changed = false;
    for (const k of Object.keys(enc)) {
      if (enc[k] !== cred[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      skipped += 1;
      continue;
    }
    await BillingAccount.updateOne({ _id: row._id }, { $set: { credentials: enc } });
    converted += 1;
  }

  console.log(
    '[billing-encrypt-credentials] done total=%d converted=%d skipped=%d',
    rows.length,
    converted,
    skipped,
  );
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
