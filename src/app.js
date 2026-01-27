const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const app = express();

// middlewares
app.use(cors());
app.use(express.json());

// rotas
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
// health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'xpdcnet-api',
    uptime: process.uptime()
  });
});

module.exports = app;

