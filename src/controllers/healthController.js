const mongoose = require('mongoose');

function basePayload() {
  return {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    systemMode: process.env.SYSTEM_MODE || 'production',
  };
}

exports.getHealth = (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'error',
    database: dbConnected ? 'connected' : 'disconnected',
    ...basePayload(),
  });
};

exports.getLive = (req, res) => {
  res.json({
    status: 'ok',
    service: 'xpdcnet-api',
    probe: 'live',
    ...basePayload(),
  });
};

exports.getReady = (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ready' : 'not_ready',
    service: 'xpdcnet-api',
    probe: 'ready',
    database: dbConnected ? 'connected' : 'disconnected',
    ...basePayload(),
  });
};
