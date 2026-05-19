const mongoose = require('mongoose');

exports.getHealth = (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.json({
    status: dbConnected ? 'ok' : 'error',
    database: dbConnected ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    systemMode: process.env.SYSTEM_MODE || 'production',
  });
};
