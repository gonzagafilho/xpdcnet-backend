const { Server } = require('socket.io');
const realtimeBus = require('./realtimeBus');

let io = null;

function initRealtime(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || process.env.ADMIN_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    socket.emit('realtime:ready', {
      ok: true,
      connectedAt: new Date().toISOString(),
    });
  });

  realtimeBus.on('xpdcnet:event', (event) => {
    if (!io || !event || !event.type) return;
    io.emit(event.type, {
      ...event.payload,
      emittedAt: new Date().toISOString(),
    });
  });

  console.log('[REALTIME] Socket.IO ativo em /socket.io');
  return io;
}

function emitRealtime(type, payload = {}) {
  realtimeBus.emit('xpdcnet:event', { type, payload });
}

module.exports = {
  initRealtime,
  emitRealtime,
};
