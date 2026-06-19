const Client = require('../models/Client');
const ClientAccess = require('../models/ClientAccess');
const { groupCustomerAccessPreview } = require('./dataImportCustomerGroupingService');

function safePreviewCustomers(grouped) {
  return grouped.customers.slice(0, 50).map((customer) => ({
    rowNumber: customer.sourceRows[0],
    fullName: customer.fullName,
    document: customer.document,
    status: customer.status,
    accessCount: customer.accessCount,
    accesses: customer.accesses.map((access) => ({
      rowNumber: access.rowNumber,
      username: access.username,
      planName: access.planName,
      matchedPppoe: access.matchedPppoe,
      hasPassword: access.hasPassword,
      errors: access.errors,
    })),
    errors: [...customer.errors, ...customer.accesses.flatMap((access) => access.errors)],
  }));
}

async function createCustomerWithAccesses({ tenantId, server, node, job, customer }) {
  const primary = customer.sourceData[0];
  let client = null;
  try {
    client = await Client.create({
      tenantId,
      networkNodeId: node?._id || null,
      fullName: customer.fullName,
      document: customer.document,
      phone: primary.whatsapp || primary.phone || '',
      email: primary.email || '',
      address: {
        zip: primary.zip || '',
        street: primary.street || '',
        number: primary.number || '',
        neighborhood: primary.neighborhood || '',
        city: primary.city || '',
        state: primary.state || '',
      },
      planId: primary.planId,
      monthlyPrice: primary.monthlyPrice,
      dueDay: 10,
      contract: { notes: primary.contract ? `Contrato de origem: ${primary.contract}` : '' },
      access: {
        authType: primary.planAuthType || 'pppoe',
        username: primary.pppoeUsername,
        password: primary.pppoePassword,
      },
      mikrotik: {
        enabled: false,
        serverId: server._id,
        profile: primary.planProfile || '',
        comment: 'Importado pela Central de Migração; sincronização não executada.',
        sync: { state: 'never' },
      },
      status: 'pending',
      notes: `Importado do arquivo ${job.originalFilename}.`,
    });

    const importedAt = new Date();
    const accessRows = customer.sourceData.map((row) => ({
      tenantId,
      clientId: client._id,
      serverId: server._id,
      networkNodeId: node?._id || null,
      planId: row.planId,
      authType: 'pppoe',
      username: row.pppoeUsername,
      password: row.pppoePassword,
      status: 'pending',
      source: 'import',
      importedFrom: job.originalFilename,
      importedAt,
    }));
    await ClientAccess.insertMany(accessRows, { ordered: true });
    return { client, accessCount: accessRows.length };
  } catch (error) {
    if (client?._id) {
      await ClientAccess.deleteMany({ tenantId, clientId: client._id });
      await Client.deleteOne({ _id: client._id, tenantId });
    }
    throw error;
  }
}

async function confirmGroupedImport({ tenantId, server, node, job, sourceRows, context }) {
  const grouped = groupCustomerAccessPreview(sourceRows, context);
  let importedRows = 0;
  let importedAccessRows = 0;
  let skippedRows = grouped.report.duplicateRows + grouped.report.invalidRows;
  const errors = [...grouped.report.errors];

  for (const customer of grouped.customers.filter((item) => item.status === 'valid')) {
    try {
      const result = await createCustomerWithAccesses({ tenantId, server, node, job, customer });
      importedRows += 1;
      importedAccessRows += result.accessCount;
    } catch (error) {
      skippedRows += 1;
      errors.push({
        row: customer.sourceRows[0],
        field: error?.code === 11000 ? 'username' : '',
        code: error?.code === 11000 ? 'DUPLICATE_DURING_CONFIRM' : 'IMPORT_ERROR',
        message: error?.code === 11000
          ? 'CPF/CNPJ ou login PPPoE tornou-se duplicado antes da confirmação.'
          : 'Não foi possível gravar este cliente e seus acessos.',
      });
    }
  }
  return { grouped, importedRows, importedAccessRows, skippedRows, errors };
}

module.exports = { safePreviewCustomers, createCustomerWithAccesses, confirmGroupedImport };
