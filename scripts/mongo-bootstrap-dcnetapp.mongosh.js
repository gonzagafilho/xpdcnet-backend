/**
 * Cria o utilizador da aplicação na base `dcnet` (password alinhada ao .env).
 *
 * Executar com uma ligação com permissão para criar utilizadores em `dcnet`, por exemplo root em `admin`:
 *
 *   mongosh "mongodb://ADMIN_USER:ADMIN_PASS@127.0.0.1:27017/admin?authSource=admin" \
 *     /home/servidor-dcnet/apps/xpdcnet-backend/scripts/mongo-bootstrap-dcnetapp.mongosh.js
 *
 * Se o utilizador já existir, use no mongosh:
 *   use dcnet
 *   db.updateUser("dcnetapp", { pwd: "DcNetMongo@2026!", roles: [{ role: "readWrite", db: "dcnet" }] })
 */
const adb = db.getSiblingDB("dcnet");
adb.createUser({
  user: "dcnetapp",
  pwd: "DcNetMongo@2026!",
  roles: [{ role: "readWrite", db: "dcnet" }],
});
print("Utilizador dcnetapp criado em dcnet.");
