const Tenant = require('../models/Tenant');
const ApiError = require('../errors/ApiError');

const DEFAULT_FINANCE_POLICY = Object.freeze({
  financeAutomationEnabled: true,
  financeGraceDays: 0,
  financeMinOverdueInvoices: 1,
  financeCutoffWindowEnabled: false,
  financeCutoffStartHour: 0,
  financeCutoffEndHour: 23,
  financeAutoReactivateWhenClear: true,
  financeAutomationMinHoldMinutes: 15,
  financeTimezone: 'America/Sao_Paulo',
  updatedBy: '',
  updatedAt: null,
});

function resolveTenantSlugFromHeaders(headers = {}) {
  const fromHeader = headers['x-tenant'];
  if (fromHeader != null && String(fromHeader).trim() !== '') {
    return String(fromHeader).trim();
  }
  const fromEnv = process.env.DEFAULT_TENANT_SLUG?.trim();
  if (fromEnv) return fromEnv;
  return 'dcnet';
}

function normalizeBoolean(v, fallback) {
  if (v === undefined) return fallback;
  return Boolean(v);
}

function normalizeInt(v, min, max, fieldName, fallback) {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw ApiError.badRequest(`${fieldName} deve ser inteiro entre ${min} e ${max}`);
  }
  return n;
}

function normalizeTimezone(v, fallback) {
  if (v === undefined) return fallback;
  const tz = String(v || '').trim();
  if (!tz) throw ApiError.badRequest('financeTimezone não pode ser vazio');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch (_) {
    throw ApiError.badRequest('financeTimezone inválido');
  }
  return tz;
}

function financePolicyFromTenantDoc(doc) {
  const p = (doc && doc.financePolicy) || {};
  return {
    financeAutomationEnabled: normalizeBoolean(p.financeAutomationEnabled, DEFAULT_FINANCE_POLICY.financeAutomationEnabled),
    financeGraceDays:
      typeof p.financeGraceDays === 'number' ? p.financeGraceDays : DEFAULT_FINANCE_POLICY.financeGraceDays,
    financeMinOverdueInvoices:
      typeof p.financeMinOverdueInvoices === 'number'
        ? p.financeMinOverdueInvoices
        : DEFAULT_FINANCE_POLICY.financeMinOverdueInvoices,
    financeCutoffWindowEnabled: normalizeBoolean(
      p.financeCutoffWindowEnabled,
      DEFAULT_FINANCE_POLICY.financeCutoffWindowEnabled,
    ),
    financeCutoffStartHour:
      typeof p.financeCutoffStartHour === 'number'
        ? p.financeCutoffStartHour
        : DEFAULT_FINANCE_POLICY.financeCutoffStartHour,
    financeCutoffEndHour:
      typeof p.financeCutoffEndHour === 'number' ? p.financeCutoffEndHour : DEFAULT_FINANCE_POLICY.financeCutoffEndHour,
    financeAutoReactivateWhenClear: normalizeBoolean(
      p.financeAutoReactivateWhenClear,
      DEFAULT_FINANCE_POLICY.financeAutoReactivateWhenClear,
    ),
    financeAutomationMinHoldMinutes: (() => {
      const raw = p.financeAutomationMinHoldMinutes;
      if (raw === undefined || raw === null) return DEFAULT_FINANCE_POLICY.financeAutomationMinHoldMinutes;
      const n = Number(raw);
      if (!Number.isFinite(n)) return DEFAULT_FINANCE_POLICY.financeAutomationMinHoldMinutes;
      return Math.min(1440, Math.max(0, Math.floor(n)));
    })(),
    financeTimezone:
      p.financeTimezone && String(p.financeTimezone).trim()
        ? String(p.financeTimezone).trim()
        : DEFAULT_FINANCE_POLICY.financeTimezone,
    updatedBy: p.updatedBy ? String(p.updatedBy) : '',
    updatedAt: p.updatedAt || null,
  };
}

async function getOperationalTenant(headers = {}) {
  const slug = resolveTenantSlugFromHeaders(headers);
  const tenant = await Tenant.findOne({ slug });
  if (!tenant || tenant.isActive === false) {
    throw ApiError.notFound(
      `Tenant não encontrado ou inativo (slug: ${slug}). Ajuste DEFAULT_TENANT_SLUG ou x-tenant, ou crie o tenant na base.`,
    );
  }
  return tenant;
}

exports.createTenant = async ({ name, slug }) => {
  if (!name || !slug) throw ApiError.badRequest('name e slug são obrigatórios');

  const exists = await Tenant.findOne({ slug });
  if (exists) throw ApiError.conflict('slug já existe');

  return Tenant.create({ name, slug });
};

exports.listTenants = async () => {
  return Tenant.find().sort({ createdAt: -1 });
};

exports.getFinancePolicyForOperationalTenant = async (headers = {}) => {
  const tenant = await getOperationalTenant(headers);
  return {
    tenantId: String(tenant._id),
    tenantSlug: String(tenant.slug),
    financePolicy: financePolicyFromTenantDoc(tenant),
  };
};

exports.updateFinancePolicyForOperationalTenant = async (headers = {}, patch = {}, user = null) => {
  const tenant = await getOperationalTenant(headers);
  const current = financePolicyFromTenantDoc(tenant);

  const next = {
    financeAutomationEnabled: normalizeBoolean(patch.financeAutomationEnabled, current.financeAutomationEnabled),
    financeGraceDays: normalizeInt(patch.financeGraceDays, 0, 120, 'financeGraceDays', current.financeGraceDays),
    financeMinOverdueInvoices: normalizeInt(
      patch.financeMinOverdueInvoices,
      1,
      20,
      'financeMinOverdueInvoices',
      current.financeMinOverdueInvoices,
    ),
    financeCutoffWindowEnabled: normalizeBoolean(
      patch.financeCutoffWindowEnabled,
      current.financeCutoffWindowEnabled,
    ),
    financeCutoffStartHour: normalizeInt(
      patch.financeCutoffStartHour,
      0,
      23,
      'financeCutoffStartHour',
      current.financeCutoffStartHour,
    ),
    financeCutoffEndHour: normalizeInt(
      patch.financeCutoffEndHour,
      0,
      23,
      'financeCutoffEndHour',
      current.financeCutoffEndHour,
    ),
    financeAutoReactivateWhenClear: normalizeBoolean(
      patch.financeAutoReactivateWhenClear,
      current.financeAutoReactivateWhenClear,
    ),
    financeAutomationMinHoldMinutes: normalizeInt(
      patch.financeAutomationMinHoldMinutes,
      0,
      1440,
      'financeAutomationMinHoldMinutes',
      current.financeAutomationMinHoldMinutes,
    ),
    financeTimezone: normalizeTimezone(patch.financeTimezone, current.financeTimezone),
    updatedBy: user?.email || user?.id || user?.sub || current.updatedBy || '',
    updatedAt: new Date(),
  };

  tenant.financePolicy = next;
  await tenant.save();

  return {
    tenantId: String(tenant._id),
    tenantSlug: String(tenant.slug),
    financePolicy: financePolicyFromTenantDoc(tenant),
  };
};

exports.DEFAULT_FINANCE_POLICY = DEFAULT_FINANCE_POLICY;
