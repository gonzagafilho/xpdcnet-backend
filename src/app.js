const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

/* ===== Middlewares ===== */
app.use(cors());
app.use(express.json());

/* ===== Rotas ===== */
app.use('/auth', authRoutes);
app.use('/users', userRoutes);

/* ===== Health Check ===== */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'xpdcnet-api',
    uptime: process.uptime()
  });
});

/* ===== Middleware global de erro (SEMPRE O ÚLTIMO) ===== */
app.use(errorHandler);

module.exports = app;
