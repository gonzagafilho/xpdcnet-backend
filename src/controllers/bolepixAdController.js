const bolepixAdService = require('../services/bolepixAdService');

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_API_URL || process.env.APP_PUBLIC_URL || '')
    .trim()
    .replace(new RegExp('/+$'), '')
    .replace(new RegExp('/api$', 'i'), '');
  if (configured) return configured;
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  return protocol + '://' + req.get('host');
}

exports.getAdmin = async (req, res, next) => {
  try {
    res.json({ ad: await bolepixAdService.getAdminAd(req.tenant._id, publicBaseUrl(req)) });
  } catch (err) {
    next(err);
  }
};

exports.upsert = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.upsertAd(req.tenant._id, req.body || {}, publicBaseUrl(req));
    res.json({ ad });
  } catch (err) {
    next(err);
  }
};

exports.setActive = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.setActive(req.tenant._id, req.body?.isActive === true, publicBaseUrl(req));
    res.json({ ad });
  } catch (err) {
    next(err);
  }
};

exports.getActiveForCustomer = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.getActiveAd(req.customer.tenantId, publicBaseUrl(req));
    res.json({ ad });
  } catch (err) {
    next(err);
  }
};
