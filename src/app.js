const express = require('express');
const cors = require('cors');

const tenantMiddleware = require('./middlewares/tenantMiddleware');
const errorHandler = require('./middlewares/errorHandler');

const tenantRoutes = require('./routes/tenantRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'xpdcnet-api' });
});

// Rotas SaaS admin (sem tenant)
app.use('/tenants', tenantRoutes);

// Rotas com tenant obrigatório
app.use('/auth', tenantMiddleware, authRoutes);

// error handler por último
app.use(errorHandler);

module.exports = app;

