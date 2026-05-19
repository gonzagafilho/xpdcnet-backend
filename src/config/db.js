const mongoose = require('mongoose');

let reconnectInterval = null;

function clearReconnectLoop() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }
}

function startReconnectLoop(uri) {
  if (reconnectInterval) return;
  reconnectInterval = setInterval(async () => {
    if (mongoose.connection.readyState === 1) {
      clearReconnectLoop();
      return;
    }
    try {
      await mongoose.connect(uri);
      console.log('[DB] MongoDB conectado (reconexão automática)');
      clearReconnectLoop();
    } catch (err) {
      console.error('[DB] Tentativa de reconexão falhou:', err.message);
    }
  }, 30000);
}

/**
 * Liga ao Mongo sem terminar o processo em caso de falha (modo degradado).
 * @returns {Promise<boolean>} true se conectado
 */
module.exports = async function connectDB() {
  const uri = process.env.MONGO_URI?.trim();

  if (!uri) {
    console.error('[DB] MONGO_URI não definido. API arranca em modo degradado.');
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log('[DB] MongoDB conectado com sucesso');
    clearReconnectLoop();
    return true;
  } catch (err) {
    console.error('[DB] Mongo connection failed:', err.message);
    startReconnectLoop(uri);
    return false;
  }
};
