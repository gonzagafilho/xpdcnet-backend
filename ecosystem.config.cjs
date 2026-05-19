/**
 * PM2 — XPDCNET (`xpdcnet-backend`)
 *
 * Subida: `pm2 start ecosystem.config.cjs`
 * Estado: `pm2 status`
 * Logs API: `pm2 logs xpdcnet-api`
 * Logs sync: `pm2 logs xpdcnet-worker-sync`
 *
 * Worker de sync: em produção com RouterOS real, defina no .env ou abaixo:
 *   MIKROTIK_SYNC_EXECUTION_MODE=live
 * O valor `simulate` (default aqui) não abre socket — útil para staging.
 *
 * Variável opcional na API (reset de palavra-passe admin):
 *   ADMIN_PASSWORD_RESET_BASE_URL=https://seu-painel.exemplo.pt
 */
const path = require('path');

const ROOT = path.join(__dirname);

module.exports = {
  apps: [
    {
      name: 'xpdcnet-api',
      cwd: ROOT,
      script: 'src/server.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 5000,
    },
    {
      name: 'xpdcnet-worker-sync',
      cwd: ROOT,
      script: 'src/workers/mikrotikSyncWorker.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        MIKROTIK_SYNC_EXECUTION_MODE: 'simulate',
        MIKROTIK_SYNC_POLL_MS: '5000',
        MIKROTIK_SYNC_BATCH: '10',
        MIKROTIK_SYNC_ROUTEROS_TIMEOUT_MS: '20000',
        MIKROTIK_SYNC_REQUEUE: '1',
        MIKROTIK_SYNC_MAX_ATTEMPTS: '5',
      },
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 5000,
    },
    {
      name: 'xpdcnet-worker-trust-expiry-enqueue',
      cwd: ROOT,
      script: 'src/workers/mikrotikTrustExpiryEnqueueWorker.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        MIKROTIK_TRUST_EXPIRY_POLL_MS: '300000',
        MIKROTIK_TRUST_EXPIRY_BATCH: '40',
      },
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 5000,
    },
    {
      name: 'xpdcnet-worker-finance-rollup',
      cwd: ROOT,
      script: 'src/workers/financeDelinquencyRollupWorker.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        FINANCE_ROLLUP_POLL_MS: '300000',
      },
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 5000,
    },
  ],
};
