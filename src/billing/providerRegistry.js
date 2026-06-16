const CoraBillingAdapter = require('./adapters/coraBillingAdapter');
const BolepixBillingAdapter = require('./adapters/bolepixBillingAdapter');

const REGISTRY = Object.freeze({
  cora: () => new CoraBillingAdapter(),
  bolepix: () => new BolepixBillingAdapter(),
});

exports.resolveAdapter = (adapterKey) => {
  const key = String(adapterKey || '').trim().toLowerCase();
  const f = REGISTRY[key];
  return f ? f() : null;
};

exports.listAdapterKeys = () => Object.keys(REGISTRY);
