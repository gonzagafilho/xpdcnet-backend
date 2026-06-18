require('dotenv').config();

const {
  connectRouteros,
  getActivePppoeSessions,
} = require('../services/mikrotikRouterosService');

async function main() {
  let connection = null;

  try {
    connection = await connectRouteros();
    const sessions = await getActivePppoeSessions(connection);
    const safeSessions = sessions.map((session) => ({
      username: session.username,
      currentIp: session.currentIp,
      uptime: session.uptime,
      service: session.service,
    }));

    console.log(JSON.stringify({ count: safeSessions.length, sessions: safeSessions }, null, 2));
  } finally {
    if (connection?.api) await connection.api.close();
  }
}

main().catch((err) => {
  console.error('[testMikrotikPppoe] falha:', err && err.message ? err.message : 'Erro desconhecido');
  process.exitCode = 1;
});
