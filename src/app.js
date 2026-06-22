const express = require('express');
const path = require('path');
const cors = require('cors');

const tenantMiddleware = require('./middlewares/tenantMiddleware');
const errorHandler = require('./middlewares/errorHandler');
const databaseReady = require('./middlewares/databaseReady');
const healthController = require('./controllers/healthController');

const tenantRoutes = require('./routes/tenantRoutes');
const authRoutes = require('./routes/authRoutes');

const planRoutes = require('./routes/planRoutes');
const clientRoutes = require('./routes/clientRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const mikrotikServerRoutes = require('./routes/mikrotikServerRoutes');
const mikrotikSyncRoutes = require('./routes/mikrotikSyncRoutes');
const mikrotikMonitoringRoutes = require('./routes/mikrotikMonitoringRoutes');
const networkNodeRoutes = require('./routes/networkNodeRoutes');
const networkConcentratorRoutes = require('./routes/networkConcentratorRoutes');
const remoteAgentRoutes = require('./routes/remoteAgentRoutes');
const agentCompatRoutes = require('./routes/agentCompatRoutes');
const systemHealthRoutes = require('./routes/systemHealthRoutes');
const billingRoutes = require('./routes/billing/billingRoutes');
const customerAppRoutes = require('./routes/customerAppRoutes');
const billingAdminRoutes = require('./routes/billingAdminRoutes');
const operationsReadRoutes = require('./routes/operations/operationsReadRoutes');
const monitoringBoardRoutes = require('./routes/monitoringBoardRoutes');
const networkTopologyRoutes = require('./routes/networkTopologyRoutes');
const systemSetupRoutes = require('./routes/systemSetupRoutes');
const requireMikrotikCryptoConfigured = require('./middlewares/requireMikrotikCryptoConfigured');
const bolepixRoutes = require('./routes/billing/bolepixRoutes');
const bolepixAdRoutes = require('./routes/bolepixAdRoutes');
const partnerAdRoutes = require('./routes/partnerAdRoutes');
const dataImportRoutes = require('./routes/dataImportRoutes');

const app = express();

app.use(cors());
app.use('/bolepix-ads', express.json({ limit: '7mb' }));
app.use('/bolepix-partners', express.json({ limit: '7mb' }));
app.use('/api/admin/data-import', express.json({ limit: '12mb' }));
app.use(express.json());
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { maxAge: '7d', immutable: true }));

app.get('/health', healthController.getHealth);
app.get('/health/live', healthController.getLive);
app.get('/health/ready', healthController.getReady);

app.use(databaseReady);

// Rotas SaaS admin (sem tenant)
app.use('/tenants', tenantRoutes);

// Autenticação do painel (Admin) — sem tenant
app.use('/auth', authRoutes);

// Configuração global (admin) — sem tenant; não exige chave MikroTik pré-configurada
app.use('/system/setup', databaseReady, systemSetupRoutes);

// Rotas operacionais: tenant resolvido no servidor (x-tenant opcional; ver DEFAULT_TENANT_SLUG)
app.use('/plans', tenantMiddleware, planRoutes);
app.use('/api/admin/plans', tenantMiddleware, planRoutes);
app.use('/clients', tenantMiddleware, clientRoutes);
app.use('/invoices', tenantMiddleware, invoiceRoutes);
app.use('/mikrotik/servers', tenantMiddleware, requireMikrotikCryptoConfigured, mikrotikServerRoutes);
app.use('/mikrotik-sync', tenantMiddleware, requireMikrotikCryptoConfigured, mikrotikSyncRoutes);
app.use('/mikrotik-monitoring', tenantMiddleware, requireMikrotikCryptoConfigured, mikrotikMonitoringRoutes);
app.use('/network-nodes', tenantMiddleware, networkNodeRoutes);
app.use('/api/admin/network/concentrators', tenantMiddleware, networkConcentratorRoutes);
app.use('/agent/v1', remoteAgentRoutes);
app.use('/agent', agentCompatRoutes);
app.use('/system/health', tenantMiddleware, systemHealthRoutes);
app.use('/billing', tenantMiddleware, billingRoutes);

app.use('/api/bolepix', bolepixRoutes);
app.use('/bolepix-ads', tenantMiddleware, bolepixAdRoutes);
app.use('/bolepix-partners', tenantMiddleware, partnerAdRoutes);
app.use('/customer-app', tenantMiddleware, customerAppRoutes);
app.use('/billing-admin', tenantMiddleware, billingAdminRoutes);
app.use('/operations', tenantMiddleware, operationsReadRoutes);
app.use('/monitoring', tenantMiddleware, monitoringBoardRoutes);
app.use('/topology', tenantMiddleware, networkTopologyRoutes);
app.use('/api/admin/data-import', tenantMiddleware, dataImportRoutes);

// error handler por último
app.use(errorHandler);

module.exports = app;
