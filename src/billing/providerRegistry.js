const CoraBillingAdapter = require('./adapters/coraBillingAdapter');

const REGISTRY = Object.freeze({ cora: () => new CoraBillingAdapter() });
const RESERVED_ADAPTER_KEYS = Object.freeze(['bolepix']);

exports.resolveAdapter = (adapterKey) => {
  const key = String(adapterKey || '').trim().toLowerCase();
  const f = REGISTRY[key];
  return f ? f() : null;
};

exports.listAdapterKeys = () => [...Object.keys(REGISTRY), ...RESERVED_ADAPTER_KEYS];
