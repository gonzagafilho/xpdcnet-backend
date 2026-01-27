const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 3000;

// conecta no banco
connectDB();

app.listen(PORT, () => {
  console.log(`🚀 XPDCNET API rodando na porta ${PORT}`);
});

