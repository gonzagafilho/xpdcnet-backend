const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const mikrotikSyncService = require('../services/mikrotikSyncService');
const operationLogService = require('../services/operationLogService');

exports.listJobs = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const qTenant = req.query.tenantId;
    if (qTenant != null && String(qTenant).trim() !== '' && String(qTenant) !== tenantId) {
      throw ApiError.badRequest('tenantId da query não corresponde ao tenant resolvido para este pedido.');
    }

    const result = await mikrotikSyncService.listJobsForTenant(tenantId, req.query);
    if (result.error === 'invalid_status') {
      throw ApiError.badRequest('Parâmetro status inválido (use pending, processing, done ou failed).');
    }
    if (result.error === 'invalid_clientId') {
      throw ApiError.badRequest('clientId inválido.');
    }
    if (result.error === 'invalid_serverId') {
      throw ApiError.badRequest('serverId inválido.');
    }

    const tenantName = req.tenant.name;
    const items = (result.items || []).map((j) => ({
      ...j,
      tenantName,
    }));

    res.json({
      items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
    });
  } catch (err) {
    next(err);
  }
};

exports.summary = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const summary = await mikrotikSyncService.getSummaryForTenant(tenantId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /mikrotik-sync/enqueue — enfileira job de sync por cliente (admin, auditável).
 * Body: { clientId, expectedServerId?, triggerReason?, triggerContext? }
 */
exports.enqueue = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const tid = req.tenant._id;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const clientId = body.clientId;
    const expectedServerId = body.expectedServerId;
    const triggerReason = body.triggerReason;

    if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
      throw ApiError.badRequest('clientId inválido.');
    }

    const client = await Client.findOne({ _id: clientId, tenantId: tid }).select('mikrotik.serverId').lean();
    if (!client) {
      throw ApiError.notFound('Cliente não encontrado para este tenant.');
    }

    if (expectedServerId != null && String(expectedServerId).trim() !== '') {
      if (!mongoose.Types.ObjectId.isValid(String(expectedServerId))) {
        throw ApiError.badRequest('expectedServerId inválido.');
      }
      const assigned = client.mikrotik && client.mikrotik.serverId != null ? String(client.mikrotik.serverId) : '';
      if (assigned !== String(expectedServerId)) {
        throw ApiError.badRequest(
          'Cliente não está associado ao servidor indicado; operação cancelada por segurança.',
        );
      }
    }

    const triggerContext = {
      ...(body.triggerContext && typeof body.triggerContext === 'object' ? body.triggerContext : {}),
    };
    if (req.user && req.user._id) {
      triggerContext.actorUserId = String(req.user._id);
    }

    const result = await mikrotikSyncService.enqueueSync(tenantId, clientId, {
      triggerReason: triggerReason || 'manual_admin_redes_servidores',
      triggerSource: 'admin_panel_redes_servidores',
      triggerContext,
    });

    if (!result) {
      throw ApiError.notFound('Cliente não encontrado para este tenant.');
    }
    if (result.skipped) {
      await operationLogService.logOperation({
        tenantId: tid,
        userId: req.user && req.user.id ? req.user.id : null,
        action: 'mikrotik_sync.enqueue',
        targetType: 'Client',
        targetId: String(clientId),
        payload: { triggerReason: triggerReason || 'manual_admin_redes_servidores', skipped: true },
        result: { reason: result.reason },
        status: 'success',
        req,
      });
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: result.reason || 'skipped',
        message:
          result.reason === 'no_server_id'
            ? 'Cliente sem servidor MikroTik associado — job não enfileirado.'
            : 'Operação não enfileirada.',
      });
    }

    const status = result.duplicate ? 200 : 201;
    await operationLogService.logOperation({
      tenantId: tid,
      userId: req.user && req.user.id ? req.user.id : null,
      action: 'mikrotik_sync.enqueue',
      targetType: 'Client',
      targetId: String(clientId),
      payload: { triggerReason: triggerReason || 'manual_admin_redes_servidores' },
      result: { duplicate: Boolean(result.duplicate), jobId: result.job && result.job._id ? String(result.job._id) : null },
      status: 'success',
      req,
    });
    return res.status(status).json({
      ok: true,
      duplicate: Boolean(result.duplicate),
      job: result.job,
    });
  } catch (err) {
    next(err);
  }
};

exports.retry = async (req, res, next) => {
  try {
    const tenantId = req.tenant._id.toString();
    const jobId = req.params.id;
    const result = await mikrotikSyncService.retryFailedJobForTenant(tenantId, jobId);

    if (result.error === 'invalid_id') {
      throw ApiError.badRequest('Identificador de job inválido.');
    }
    if (result.error === 'not_found') {
      throw ApiError.notFound(
        'Job não encontrado para este tenant (ID inexistente ou pertence a outro tenant).',
      );
    }
    if (result.error === 'not_failed') {
      throw ApiError.badRequest(
        'Reenvio manual só é permitido para jobs em estado «failed». Verifique o estado na listagem.',
      );
    }
    if (result.error === 'conflict_open') {
      throw ApiError.conflict(
        'Não é possível reenviar: já existe outro job pendente ou em processamento para este cliente.',
        'SYNC_JOB_OPEN',
      );
    }

    await operationLogService.logOperation({
      tenantId: req.tenant._id,
      userId: req.user && req.user.id ? req.user.id : null,
      action: 'mikrotik_sync.retry',
      targetType: 'MikrotikSyncJob',
      targetId: String(jobId),
      result: { jobId: result.job && result.job._id ? String(result.job._id) : String(jobId) },
      status: 'success',
      req,
    });

    res.status(200).json(result.job);
  } catch (err) {
    next(err);
  }
};
