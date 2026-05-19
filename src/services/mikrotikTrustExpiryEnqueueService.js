/**
 * Enfileira re-sync quando a confiança (trustRelease) expirou — só MongoDB, sem RouterOS.
 * Worker dedicado separado do mikrotikSyncWorker.
 */

const Client = require('../models/Client');
const clientNetworkPolicyService = require('./clientNetworkPolicyService');
const mikrotikSyncService = require('./mikrotikSyncService');
const { TRIGGER_REASONS } = require('./mikrotikSyncTriggerCatalog');

// Alinhado a clientNetworkPolicyService (TRUST_MS_SLOP)
const TRUST_SLOP_MS = 60_000;

const LOG_PREFIX = '[xpdcnet-trust-expiry-enqueue]';

/**
 * Um lote: delinquentes com trust configurado, until passou (fora da margem de relógio), com servidor MikroTik.
 * Idempotência: `trustRelease.lastExpiryEnqueueForUntil` === `until` → ignora.
 *
 * @param {object} [opts]
 * @param {number} [opts.batchLimit] — máximo de clientes a avaliar por tick (cap interno 200)
 * @returns {Promise<{ examined: number, enqueued: number, duplicates: number, skipped: number }>}
 */
exports.runTrustExpiryEnqueueTick = async (opts = {}) => {
  const batchLimit = Math.min(200, Math.max(1, Number(opts.batchLimit) || 50));
  const now = new Date();
  const cutoff = new Date(now.getTime() - TRUST_SLOP_MS);

  const candidates = await Client.find({
    status: 'delinquent',
    'trustRelease.enabled': true,
    'trustRelease.until': { $lte: cutoff },
    'mikrotik.serverId': { $ne: null },
    $or: [
      { 'trustRelease.lastExpiryEnqueueForUntil': null },
      { $expr: { $ne: ['$trustRelease.lastExpiryEnqueueForUntil', '$trustRelease.until'] } },
    ],
  })
    .limit(batchLimit)
    .select('_id tenantId status trustRelease mikrotik.serverId')
    .lean();

  let enqueued = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const c of candidates) {
    const until = c.trustRelease?.until ? new Date(c.trustRelease.until) : null;
    if (!until || Number.isNaN(until.getTime())) {
      skipped += 1;
      continue;
    }

    if (clientNetworkPolicyService.isTrustReleaseActive(c.trustRelease, now)) {
      skipped += 1;
      continue;
    }

    const tid = String(c.tenantId);
    const cid = String(c._id);

    const result = await mikrotikSyncService.enqueueSync(tid, cid, {
      triggerReason: TRIGGER_REASONS.TRUST_RELEASE_EXPIRED,
      triggerSource: 'scheduler.trust_release_expiry',
      triggerContext: {
        status: c.status,
        trustUntilIso: until.toISOString(),
      },
      refreshIntentOnDuplicate: true,
    });

    if (!result) {
      skipped += 1;
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    if (result.duplicate) duplicates += 1;
    else enqueued += 1;

    await Client.updateOne(
      { _id: c._id, tenantId: tid },
      { $set: { 'trustRelease.lastExpiryEnqueueForUntil': until } },
    );
  }

  if (candidates.length > 0) {
    console.log(
      `${LOG_PREFIX} tick batch=%d examined=%d enqueued=%d duplicates=%d skipped=%d`,
      batchLimit,
      candidates.length,
      enqueued,
      duplicates,
      skipped,
    );
  }

  return { examined: candidates.length, enqueued, duplicates, skipped };
};

exports.LOG_PREFIX = LOG_PREFIX;
