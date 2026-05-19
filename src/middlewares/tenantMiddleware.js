const Tenant = require('../models/Tenant');
const ApiError = require('../errors/ApiError');

/**
 * Resolve o tenant operacional sem obrigar x-tenant no painel DCNET (empresa única).
 * Ordem: header x-tenant (compatibilidade) → DEFAULT_TENANT_SLUG → slug fixo "dcnet".
 * tenantId nos documentos permanece inalterado nesta fase.
 */
function resolveTenantSlug(req) {
  const fromHeader = req.headers['x-tenant'];
  if (fromHeader != null && String(fromHeader).trim() !== '') {
    return String(fromHeader).trim();
  }
  const fromEnv = process.env.DEFAULT_TENANT_SLUG?.trim();
  if (fromEnv) return fromEnv;
  return 'dcnet';
}

module.exports = async (req, res, next) => {
  try {
    const slug = resolveTenantSlug(req);
    const tenant = await Tenant.findOne({ slug });
    if (!tenant || tenant.isActive === false) {
      return next(
        ApiError.notFound(
          `Tenant não encontrado ou inativo (slug: ${slug}). Ajuste DEFAULT_TENANT_SLUG ou x-tenant, ou crie o tenant na base.`,
        ),
      );
    }
    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
};
