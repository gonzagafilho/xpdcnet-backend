# Operação XPDCNET (backend)

## Processos PM2

| App | Script | Função |
|-----|--------|--------|
| `xpdcnet-api` | `src/server.js` | API HTTP |
| `xpdcnet-worker-sync` | `src/workers/mikrotikSyncWorker.js` | Fila MikroTik |
| `xpdcnet-worker-finance-rollup` | `src/workers/financeDelinquencyRollupWorker.js` | Faturas overdue + status delinquent/active |
| `xpdcnet-worker-trust-expiry-enqueue` | `src/workers/mikrotikTrustExpiryEnqueueWorker.js` | Re-sync após expirar trust |

Subida: `pm2 start ecosystem.config.cjs` (a partir deste diretório).

## Se um worker não estiver a correr

- **Sem finance rollup:** faturas `pending` não passam a `overdue` automaticamente; clientes não entram/saem de `delinquent` pela política.
- **Sem sync worker:** jobs `MikrotikSyncJob` ficam em `pending`; RouterOS não é actualizado (em modo `live`).

## Comandos úteis

```bash
pm2 status
pm2 logs xpdcnet-worker-sync --lines 80
pm2 logs xpdcnet-worker-finance-rollup --lines 40
```

## Variáveis relevantes

- `MIKROTIK_SYNC_EXECUTION_MODE`: `simulate` | `dry-run` | `live` (RouterOS real só em `live`).
- `FINANCE_ROLLUP_POLL_MS`: intervalo do rollup (ms), default 300000 no worker.
- `ADMIN_PASSWORD_RESET_BASE_URL`: URL pública do painel para links de reset de admin.

## NPM scripts (referência)

- `npm run worker:sync`
- `npm run worker:finance-rollup`
- `npm run worker:trust-expiry-enqueue`
