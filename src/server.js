require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');

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

  app.listen(PORT, () => {
    const mode = process.env.SYSTEM_MODE || 'production';
    console.log(`[API] XPDCNET API rodando na porta ${PORT} (SYSTEM_MODE=${mode})`);
  });
})();
