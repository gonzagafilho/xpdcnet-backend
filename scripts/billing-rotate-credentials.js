#!/usr/bin/env node
/**
 * Rotação / re-encriptação de BillingAccount.credentials (campos sensíveis).
 *
 * Regras:
 * - Por omissão corre em dry-run (não grava). Use --apply para persistir.
 * - Não escreve segredos em stdout (apenas contagens e ids de conta).
 * - Exige capacidade de decrypt (todas as chaves necessárias no anel) e encrypt (chave activa).
 *
 * Env: mesmo contrato que src/services/encryptionService.js (modo anel ou legado).
 */
require('dotenv').config();

const connectDB = require('../src/config/db');
const BillingAccount = require('../src/models/billing/BillingAccount');
const billingCredentialsCrypto = require('../src/services/billing/billingCredentialsCrypto');
const encryptionService = require('../src/services/encryptionService');

function parseArgs() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  return { apply, dryRun };
}

async function main() {
  const { apply, dryRun } = parseArgs();

  try {
    encryptionService.getBillingKeyRing();
  } catch (e) {
    console.error('[billing-rotate-credentials] Ambiente inválido:', e.message);
    return 1;
  }

  const ok = await connectDB();
  if (!ok) {
    console.error('[billing-rotate-credentials] MongoDB indisponível');
    return 1;
  }

  const rows = await BillingAccount.find({}).select('_id tenantId credentials').lean();
  let accountsTouched = 0;
  let fieldsRewritten = 0;
  let skippedNoSecrets = 0;
  let errors = 0;

  for (const row of rows) {
    const cred = row.credentials;
    if (!cred || typeof cred !== 'object') {
      skippedNoSecrets += 1;
      continue;
    }
    if (!billingCredentialsCrypto.credentialsContainSecrets(cred)) {
      skippedNoSecrets += 1;
      continue;
    }

    let changed = false;
    const next = { ...cred };
    let accountError = false;

    for (const k of billingCredentialsCrypto.SENSITIVE_KEYS) {
      const v = next[k];
      if (v == null || typeof v !== 'string' || !String(v).trim()) continue;
      let plain;
      try {
        plain = encryptionService.decryptBillingField(v);
      } catch (err) {
        console.error(
          '[billing-rotate-credentials] decrypt falhou conta=%s campo=%s code=%s',
          String(row._id),
          k,
          err && err.code ? err.code : '—',
        );
        errors += 1;
        accountError = true;
        break;
      }
      const reEnc = encryptionService.encryptBillingField(plain);
      if (reEnc !== v) {
        next[k] = reEnc;
        changed = true;
        fieldsRewritten += 1;
      }
    }

    if (accountError) continue;

    if (changed) {
      accountsTouched += 1;
      if (apply) {
        await BillingAccount.updateOne({ _id: row._id }, { $set: { credentials: next } });
      }
    }
  }

  console.log(
    '[billing-rotate-credentials] %s totalAccounts=%d accountsTouched=%d fieldsRewritten=%d skippedNoSecrets=%d errors=%d',
    dryRun ? 'DRY-RUN' : 'APPLY',
    rows.length,
    accountsTouched,
    fieldsRewritten,
    skippedNoSecrets,
    errors,
  );
  if (dryRun && accountsTouched > 0) {
    console.log('[billing-rotate-credentials] Nada foi gravado. Reexecute com --apply para persistir.');
  }
  return errors > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[billing-rotate-credentials] fatal:', e.message || e);
    process.exit(1);
  });
