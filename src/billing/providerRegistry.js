const CoraBillingAdapter = require('./adapters/coraBillingAdapter');

const REGISTRY = Object.freeze({ cora: () => new CoraBillingAdapter() });

exports.resolveAdapter = (adapterKey) => {
  const key = String(adapterKey || '').trim().toLowerCase();
  const f = REGISTRY[key];
  return f ? f() : null;
};

exports.listAdapterKeys = () => Object.keys(REGISTRY);
