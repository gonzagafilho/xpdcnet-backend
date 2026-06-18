const service = require('../services/partnerAdService');
function base(req) {
  const configured = String(process.env.PUBLIC_API_URL || process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (configured) return configured;
  const proto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim() || req.protocol;
  return `${proto}://${req.get('host')}`;
}
exports.list = async (req, res, next) => { try { res.json({ items: await service.list(req.tenant._id, base(req)) }); } catch (e) { next(e); } };
exports.create = async (req, res, next) => { try { res.status(201).json({ item: await service.create(req.tenant._id, req.body || {}, base(req)) }); } catch (e) { next(e); } };
exports.update = async (req, res, next) => { try { res.json({ item: await service.update(req.tenant._id, req.params.id, req.body || {}, base(req)) }); } catch (e) { next(e); } };
exports.setActive = async (req, res, next) => { try { res.json({ item: await service.setActive(req.tenant._id, req.params.id, req.body?.isActive === true, base(req)) }); } catch (e) { next(e); } };
exports.remove = async (req, res, next) => { try { await service.remove(req.tenant._id, req.params.id); res.status(204).end(); } catch (e) { next(e); } };
exports.stats = async (req, res, next) => { try { res.json(await service.stats(req.tenant._id, base(req))); } catch (e) { next(e); } };
exports.customerList = async (req, res, next) => { try { res.json({ items: await service.selectAndRecord(req.customer.tenantId, base(req)) }); } catch (e) { next(e); } };
exports.customerClick = async (req, res, next) => { try { res.json(await service.recordClick(req.customer.tenantId, req.params.id)); } catch (e) { next(e); } };
