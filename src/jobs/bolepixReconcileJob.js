const cron = require('node-cron');
const mercadoPagoPixService = require('../services/billing/mercadoPagoPixService');

function startBolepixReconcileJob() {
  const enabled = String(process.env.BOLEPIX_RECONCILE_ENABLED || 'false') === 'true';

  if (!enabled) {
    console.log('[bolepix_reconcile] disabled');
    return;
  }

  const schedule = process.env.BOLEPIX_RECONCILE_CRON || '*/10 * * * *';

  cron.schedule(schedule, async () => {
    try {
      console.log('[bolepix_reconcile] run_start');
      const results = await mercadoPagoPixService.reconcilePendingPayments(50);
      console.log('[bolepix_reconcile] run_done', { count: results.length });
    } catch (err) {
      console.error('[bolepix_reconcile] run_error', err);
    }
  });

  console.log('[bolepix_reconcile] scheduled', schedule);
}

module.exports = {
  startBolepixReconcileJob,
};
