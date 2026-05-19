/**
 * JWT em produção exige JWT_SECRET definido; nunca usar fallback fraco em NODE_ENV=production.
 */
function getJwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  console.warn('[AUTH] JWT_SECRET ausente; usando fallback apenas para desenvolvimento.');
  return 'dcnet_dev_insecure_secret_change_me';
}

module.exports = { getJwtSecret };
