const mongoose = require('mongoose');
const ApiError = require('../errors/ApiError');
const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');
const Plan = require('../models/Plan');
const MikrotikServer = require('../models/MikrotikServer');
const NetworkNode = require('../models/NetworkNode');
const PppoeLiveSnapshot = require('../models/PppoeLiveSnapshot');
const DataImportJob = require('../models/DataImportJob');
const parser = require('./dataImportParserService');
const { groupCustomerAccessPreview } = require('./dataImportCustomerGroupingService');
const { safePreviewCustomers, confirmGroupedImport } = require('./dataImportMultiAccessService');

const TEMPLATE_COLUMNS = [
  'nome', 'cpf_cnpj', 'whatsapp', 'telefone', 'email', 'cep', 'endereco', 'numero',
  'bairro', 'cidade', 'uf', 'plano', 'contrato', 'login_pppoe', 'senha_pppoe', 'concentrador',
];

function tenantObjectId(value) {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw ApiError.badRequest('Tenant inválido.');
  return new mongoose.Types.ObjectId(String(value));
}

function publicJob(job) {
  const row = typeof job.toObject === 'function' ? job.toObject() : job;
  return {
    id: String(row._id),
    type: row.type,
    source: row.source,
    originalFilename: row.originalFilename,
    status: row.status,
    target: {
      serverId: row.targetServerId ? String(row.targetServerId) : null,
      serverName: row.targetServerName,
      networkNodeId: row.targetNetworkNodeId ? String(row.targetNetworkNodeId) : null,
      networkNodeName: row.targetNetworkNodeName || '',
    },
    detectedColumns: row.detectedColumns || [],
    columnMapping: row.columnMapping instanceof Map ? Object.fromEntries(row.columnMapping) : row.columnMapping || {},
    previewRows: row.previewRows || [],
    report: {
      totalRows: row.totalRows || 0,
      totalAccessRows: row.totalAccessRows || row.totalRows || 0,
      multiAccessCustomers: row.multiAccessCustomers || 0,
      criticalDuplicateRows: row.criticalDuplicateRows || row.duplicateRows || 0,
      validRows: row.validRows || 0,
      duplicateRows: row.duplicateRows || 0,
      invalidRows: row.invalidRows || 0,
      matchedPppoeRows: row.matchedPppoeRows || 0,
      unmatchedPppoeRows: row.unmatchedPppoeRows || 0,
      importedRows: row.importedRows || 0,
      importedAccessRows: row.importedAccessRows || 0,
      skippedRows: row.skippedRows || 0,
      errors: row.errorItems || [],
    },
    createdBy: row.createdBy || '',
    createdAt: row.createdAt || null,
    completedAt: row.completedAt || null,
  };
}

async function targetServer(tenantId, serverId) {
  if (!mongoose.Types.ObjectId.isValid(String(serverId))) throw ApiError.badRequest('Concentrador destino inválido.');
  const server = await MikrotikServer.findOne({ _id: serverId, tenantId, isActive: true }).select('-password').lean();
  if (!server) throw ApiError.notFound('Concentrador destino ativo não encontrado.');
  const node = server.networkNodeId
    ? await NetworkNode.findOne({ _id: server.networkNodeId, tenantId, isActive: true }).lean()
    : null;
  return { server, node };
}

function planKey(value) {
  return parser.normalizeHeader(value);
}

async function validationContext(tenantId, rows) {
  const usernames = [...new Set(rows.map((row) => row.pppoeUsername).filter(Boolean))];
  const [plans, existingClients, existingAccesses, livePppoe] = await Promise.all([
    Plan.find({ tenantId, isActive: true }).select('_id name price authType mikrotik').lean(),
    Client.find({ tenantId }).select('document access.username').lean(),
    ClientAccess.find({ tenantId }).select('username').lean(),
    usernames.length
      ? PppoeLiveSnapshot.find({ tenantId: String(tenantId), pppoeUsername: { $in: usernames } })
        .select('pppoeUsername').lean()
      : [],
  ]);
  return {
    planByName: new Map(plans.map((plan) => [planKey(plan.name), plan])),
    existingDocuments: new Set(existingClients.map((client) => String(client.document || '').replace(/\D/g, '')).filter(Boolean)),
    existingUsernames: new Set(
      [
        ...existingClients.map((client) => String(client.access?.username || '').toLowerCase()),
        ...existingAccesses.map((access) => String(access.username || '').toLowerCase()),
      ].filter(Boolean),
    ),
    livePppoe: new Set(livePppoe.map((row) => String(row.pppoeUsername || '').toLowerCase())),
  };
}

function validateRows(rows, context) {
  const seenDocuments = new Set();
  const seenUsernames = new Set();
  const normalizedRows = [];
  const previewRows = [];
  const allErrors = [];
  let validRows = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  let matchedPppoeRows = 0;

  for (const row of rows) {
    const errors = [];
    let duplicate = false;
    const add = (field, code, message) => {
      const item = { row: row.rowNumber, field, code, message };
      errors.push(item);
      allErrors.push(item);
    };
    if (!row.fullName) add('fullName', 'REQUIRED', 'Nome é obrigatório.');
    if (!row.document) add('document', 'REQUIRED', 'CPF/CNPJ é obrigatório.');
    else if (!parser.documentValid(row.document)) add('document', 'INVALID_DOCUMENT', 'CPF/CNPJ inválido.');
    if (!row.plan) add('plan', 'REQUIRED', 'Plano é obrigatório.');
    const plan = context.planByName.get(planKey(row.plan));
    if (row.plan && !plan) add('plan', 'PLAN_NOT_FOUND', 'Plano não encontrado no catálogo ativo.');
    if (!row.pppoeUsername) add('pppoeUsername', 'REQUIRED', 'Login PPPoE é obrigatório.');
    if (!row.pppoePassword) add('pppoePassword', 'REQUIRED', 'Senha PPPoE é obrigatória.');
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) add('email', 'INVALID_EMAIL', 'E-mail inválido.');
    if (row.document && (seenDocuments.has(row.document) || context.existingDocuments.has(row.document))) {
      duplicate = true;
      add('document', 'DUPLICATE_DOCUMENT', 'CPF/CNPJ já existe no arquivo ou no XPDCNET.');
    }
    if (row.pppoeUsername && (seenUsernames.has(row.pppoeUsername) || context.existingUsernames.has(row.pppoeUsername))) {
      duplicate = true;
      add('pppoeUsername', 'DUPLICATE_PPPOE', 'Login PPPoE já existe no arquivo ou no XPDCNET.');
    }
    if (row.document) seenDocuments.add(row.document);
    if (row.pppoeUsername) seenUsernames.add(row.pppoeUsername);
    const matchedPppoe = context.livePppoe.has(row.pppoeUsername);
    if (matchedPppoe) matchedPppoeRows += 1;
    let status = 'valid';
    if (duplicate) {
      status = 'duplicate';
      duplicateRows += 1;
    } else if (errors.length) {
      status = 'invalid';
      invalidRows += 1;
    } else validRows += 1;
    normalizedRows.push({
      ...row,
      planId: plan ? String(plan._id) : null,
      planName: plan ? plan.name : '',
      monthlyPrice: plan ? Number(plan.price) : null,
      planAuthType: plan ? plan.authType : 'pppoe',
      planProfile: plan?.mikrotik?.profile || '',
      validationStatus: status,
      validationErrors: errors,
      matchedPppoe,
    });
    if (previewRows.length < 50) previewRows.push(parser.safePreviewRow(row, status, errors, plan?.name, matchedPppoe));
  }
  return {
    normalizedRows,
    previewRows,
    errors: allErrors.slice(0, 250),
    report: {
      totalRows: rows.length,
      validRows,
      duplicateRows,
      invalidRows,
      matchedPppoeRows,
      importedRows: 0,
      skippedRows: duplicateRows + invalidRows,
    },
  };
}

exports.listTargets = async (tenantIdValue) => {
  const tenantId = tenantObjectId(tenantIdValue);
  const rows = await MikrotikServer.find({ tenantId, isActive: true })
    .select('_id name host port executionMode networkNodeId').sort({ name: 1 }).lean();
  const nodeIds = rows.map((row) => row.networkNodeId).filter(Boolean);
  const nodes = nodeIds.length
    ? await NetworkNode.find({ tenantId, _id: { $in: nodeIds } }).select('_id name code config').lean()
    : [];
  const nodeById = new Map(nodes.map((node) => [String(node._id), node]));
  return rows.map((row) => {
    const node = row.networkNodeId ? nodeById.get(String(row.networkNodeId)) : null;
    return {
      id: String(row._id),
      name: row.name,
      host: row.host,
      port: row.port,
      executionMode: row.executionMode,
      node: node ? { id: String(node._id), name: node.name, code: node.code } : null,
      pop: node?.config?.popName || row.name,
    };
  });
};

exports.previewCustomers = async (payload, authContext) => {
  const tenantId = tenantObjectId(authContext.tenantId);
  const parsed = parser.parseUpload(payload);
  const mapping = parser.normalizeMapping(parsed.headers, payload.columnMapping);
  const rows = parsed.rows.map((row) => parser.normalizeRecord(row, mapping));
  const [{ server, node }, context] = await Promise.all([
    targetServer(tenantId, payload.targetServerId),
    validationContext(tenantId, rows),
  ]);
  const grouped = groupCustomerAccessPreview(rows, context);
  const multiAccessCustomers = grouped.customers.filter((customer) => customer.accessCount > 1).length;
  const values = {
    tenantId,
    type: 'customers',
    source: parsed.source,
    originalFilename: parsed.originalFilename,
    fileHash: parsed.fileHash,
    status: 'preview',
    targetServerId: server._id,
    targetServerName: server.name,
    targetNetworkNodeId: node?._id || null,
    targetNetworkNodeName: node?.name || '',
    detectedColumns: parsed.headers,
    columnMapping: mapping,
    previewRows: safePreviewCustomers(grouped),
    normalizedRows: rows,
    totalRows: grouped.report.totalRows,
    totalAccessRows: grouped.report.totalAccessRows,
    multiAccessCustomers,
    criticalDuplicateRows: grouped.report.duplicateRows,
    validRows: grouped.report.validRows,
    duplicateRows: grouped.report.duplicateRows,
    invalidRows: grouped.report.invalidRows,
    matchedPppoeRows: grouped.report.matchedPppoeRows,
    unmatchedPppoeRows: grouped.report.unmatchedPppoeRows,
    importedRows: 0,
    importedAccessRows: 0,
    skippedRows: grouped.report.skippedRows,
    errorItems: grouped.report.errors,
    createdBy: String(authContext.userId || ''),
    completedAt: null,
  };
  let job;
  if (payload.jobId && mongoose.Types.ObjectId.isValid(String(payload.jobId))) {
    job = await DataImportJob.findOneAndUpdate(
      { _id: payload.jobId, tenantId, status: 'preview' },
      { $set: values },
      { new: true },
    );
  }
  if (!job) job = await DataImportJob.create(values);
  return publicJob(job);
};

exports.confirmCustomers = async (jobId, authContext) => {
  const tenantId = tenantObjectId(authContext.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) throw ApiError.badRequest('Job de importação inválido.');
  const job = await DataImportJob.findOne({ _id: jobId, tenantId }).select('+normalizedRows');
  if (!job) throw ApiError.notFound('Preview de importação não encontrado.');
  if (job.status !== 'preview') throw ApiError.conflict('Este job já foi finalizado.', 'IMPORT_ALREADY_FINALIZED');
  const { server, node } = await targetServer(tenantId, job.targetServerId);
  const sourceRows = Array.isArray(job.normalizedRows) ? job.normalizedRows : [];
  const context = await validationContext(tenantId, sourceRows);
  const result = await confirmGroupedImport({ tenantId, server, node, job, sourceRows, context });

  job.status = 'completed';
  job.totalRows = result.grouped.report.totalRows;
  job.totalAccessRows = result.grouped.report.totalAccessRows;
  job.multiAccessCustomers = result.grouped.customers.filter((customer) => customer.accessCount > 1).length;
  job.criticalDuplicateRows = result.grouped.report.duplicateRows;
  job.importedRows = result.importedRows;
  job.importedAccessRows = result.importedAccessRows;
  job.skippedRows = result.skippedRows;
  job.duplicateRows = result.grouped.report.duplicateRows;
  job.invalidRows = result.grouped.report.invalidRows;
  job.validRows = result.grouped.report.validRows;
  job.matchedPppoeRows = result.grouped.report.matchedPppoeRows;
  job.unmatchedPppoeRows = result.grouped.report.unmatchedPppoeRows;
  job.errorItems = result.errors.slice(0, 250);
  job.completedAt = new Date();
  await job.save();
  return publicJob(job);
};

exports.listJobs = async (tenantIdValue, query = {}) => {
  const tenantId = tenantObjectId(tenantIdValue);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  const filter = { tenantId };
  if (query.status && ['preview', 'completed', 'failed'].includes(String(query.status))) filter.status = String(query.status);
  const rows = await DataImportJob.find(filter).sort({ createdAt: -1 }).limit(limit);
  return rows.map(publicJob);
};

exports.csvTemplate = () => `\uFEFF${TEMPLATE_COLUMNS.join(',')}\r\n`;
exports._test = { validateRows, validationContext, TEMPLATE_COLUMNS };
