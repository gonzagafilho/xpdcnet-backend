require('dotenv').config();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { initRealtime } = require('./realtime/socketServer');
const { startBolepixReconcileJob } = require('./jobs/bolepixReconcileJob');

const PORT = process.env.PORT || 3000;

(async () => {
  const dbOk = await connectDB();

  if (!dbOk) {
    console.warn('[API] Servidor a iniciar sem ligação à base de dados (modo degradado).');
  } else {
    try {
      const encryptionService = require('./services/encryptionService');
      await encryptionService.hydrateMikrotikSecretFromDatabase();
    } catch (e) {
      console.error('[API] Falha ao carregar configuração de criptografia MikroTik:', e && e.message ? e.message : e);
    }
  }

  const server = http.createServer(app);

  initRealtime(server);

  server.listen(PORT, () => {
    startBolepixReconcileJob();

    const mode = process.env.SYSTEM_MODE || 'production';

    console.log(
      `[API] XPDCNET API rodando na porta ${PORT} (SYSTEM_MODE=${mode})`
    );
  });
})();
