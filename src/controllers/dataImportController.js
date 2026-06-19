const ApiError = require('../errors/ApiError');
const dataImportService = require('../services/dataImportService');

function authContext(req) {
  return {
    tenantId: req.tenant?._id?.toString(),
    userId: req.user?.id || req.user?.sub || '',
  };
}

exports.listTargets = async (req, res, next) => {
  try {
    res.json({ items: await dataImportService.listTargets(authContext(req).tenantId) });
  } catch (error) {
    next(error);
  }
};

exports.previewCustomers = async (req, res, next) => {
  try {
    res.status(201).json(await dataImportService.previewCustomers(req.body || {}, authContext(req)));
  } catch (error) {
    next(error);
  }
};

exports.confirmCustomers = async (req, res, next) => {
  try {
    if (req.body?.confirm !== true) throw ApiError.badRequest('Confirmação explícita é obrigatória.');
    res.json(await dataImportService.confirmCustomers(req.params.id, authContext(req)));
  } catch (error) {
    next(error);
  }
};

exports.listJobs = async (req, res, next) => {
  try {
    res.json({ items: await dataImportService.listJobs(authContext(req).tenantId, req.query || {}) });
  } catch (error) {
    next(error);
  }
};

exports.downloadTemplate = (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="xpdcnet-modelo-clientes.csv"');
  res.send(dataImportService.csvTemplate());
};
