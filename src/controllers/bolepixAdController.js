const bolepixAdService = require('../services/bolepixAdService');

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_API_URL || process.env.APP_PUBLIC_URL || '')
    .trim()
    .replace(new RegExp('/+$'), '')
    .replace(new RegExp('/api$', 'i'), '');
  if (configured) return configured;
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return (forwardedProto || req.protocol) + '://' + req.get('host');
}

exports.list = async (req, res, next) => {
  try {
    res.json({ items: await bolepixAdService.listAds(req.tenant._id, publicBaseUrl(req)) });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.createAd(req.tenant._id, req.body || {}, publicBaseUrl(req));
    res.status(201).json({ ad });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.updateAd(req.tenant._id, req.params.id, req.body || {}, publicBaseUrl(req));
    res.json({ ad });
  } catch (err) { next(err); }
};

exports.setActive = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.setActive(req.tenant._id, req.params.id, req.body?.isActive === true, publicBaseUrl(req));
    res.json({ ad });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    await bolepixAdService.deleteAd(req.tenant._id, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
};

exports.stats = async (req, res, next) => {
  try {
    res.json(await bolepixAdService.getStats(req.tenant._id, publicBaseUrl(req)));
  } catch (err) { next(err); }
};

exports.getActiveForCustomer = async (req, res, next) => {
  try {
    const ad = await bolepixAdService.selectAndRecordImpression(req.customer.tenantId, publicBaseUrl(req));
    res.json({ ad });
  } catch (err) { next(err); }
};

exports.recordClickForCustomer = async (req, res, next) => {
  try {
    res.json(await bolepixAdService.recordClick(req.customer.tenantId, req.params.id));
  } catch (err) { next(err); }
};
