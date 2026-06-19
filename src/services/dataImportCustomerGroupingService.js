const parser = require('./dataImportParserService');

function normalizedNameScore(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').length;
}

function titleCaseName(value) {
  const lowerWords = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, index) => (index > 0 && lowerWords.has(word) ? word : word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1)))
    .join(' ');
}

function preferredName(rows) {
  const selected = rows
    .map((row) => String(row.fullName || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort((a, b) => normalizedNameScore(b) - normalizedNameScore(a))[0] || '';
  return titleCaseName(selected);
}

function groupCustomerAccessPreview(rows, context) {
  const groups = new Map();
  const accessUsernames = new Set();
  const existingDocuments = context.existingDocuments || new Set();
  const existingUsernames = context.existingUsernames || new Set();
  const livePppoe = context.livePppoe || new Set();
  const planByName = context.planByName || new Map();

  for (const row of rows) {
    const document = String(row.document || '').replace(/\D/g, '');
    const key = document || `row:${row.rowNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, document });
  }

  const customers = [];
  let validRows = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  let matchedPppoeRows = 0;
  let accessRows = 0;
  const errors = [];

  for (const sourceRows of groups.values()) {
    const document = sourceRows[0].document;
    const customerErrors = [];
    const addCustomerError = (code, message) => {
      const item = { row: sourceRows[0].rowNumber, field: 'document', code, message };
      customerErrors.push(item);
      errors.push(item);
    };

    if (!document) addCustomerError('REQUIRED', 'CPF/CNPJ é obrigatório.');
    else if (!parser.documentValid(document)) addCustomerError('INVALID_DOCUMENT', 'CPF/CNPJ inválido.');
    else if (existingDocuments.has(document)) {
      addCustomerError('DUPLICATE_DOCUMENT_EXISTING', 'CPF/CNPJ já existe no XPDCNET.');
    }

    const accesses = sourceRows.map((row) => {
      const accessErrors = [];
      const addAccessError = (field, code, message) => {
        const item = { row: row.rowNumber, field, code, message };
        accessErrors.push(item);
        errors.push(item);
      };
      const username = String(row.pppoeUsername || '').trim().toLowerCase();
      const plan = planByName.get(parser.normalizeHeader(row.plan));
      if (!username) addAccessError('pppoeUsername', 'REQUIRED', 'Login PPPoE é obrigatório.');
      else if (existingUsernames.has(username) || accessUsernames.has(username)) {
        addAccessError('pppoeUsername', 'DUPLICATE_PPPOE', 'Login PPPoE já existe no arquivo ou no XPDCNET.');
      }
      if (!row.pppoePassword) addAccessError('pppoePassword', 'REQUIRED', 'Senha PPPoE é obrigatória.');
      if (!row.plan) addAccessError('plan', 'REQUIRED', 'Plano é obrigatório.');
      else if (!plan) addAccessError('plan', 'PLAN_NOT_FOUND', 'Plano não encontrado no catálogo ativo.');
      if (username) accessUsernames.add(username);
      const matchedPppoe = livePppoe.has(username);
      if (matchedPppoe) matchedPppoeRows += 1;
      accessRows += 1;
      return {
        rowNumber: row.rowNumber,
        username,
        hasPassword: Boolean(row.pppoePassword),
        password: row.pppoePassword,
        planId: plan ? String(plan._id) : null,
        planName: plan?.name || row.plan || '',
        matchedPppoe,
        errors: accessErrors,
      };
    });

    const hasDuplicate = customerErrors.some((error) => error.code.startsWith('DUPLICATE'))
      || accesses.some((access) => access.errors.some((error) => error.code.startsWith('DUPLICATE')));
    const hasInvalid = customerErrors.length > 0 || accesses.some((access) => access.errors.length > 0);
    let status = 'valid';
    if (hasDuplicate) {
      status = 'duplicate';
      duplicateRows += 1;
    } else if (hasInvalid) {
      status = 'invalid';
      invalidRows += 1;
    } else {
      validRows += 1;
    }

    customers.push({
      document,
      fullName: preferredName(sourceRows),
      status,
      sourceRows: sourceRows.map((row) => row.rowNumber),
      accessCount: accesses.length,
      accesses,
      sourceData: sourceRows.map((row) => ({
        ...row,
        planId: accesses.find((access) => access.rowNumber === row.rowNumber)?.planId || null,
        planName: accesses.find((access) => access.rowNumber === row.rowNumber)?.planName || row.plan || '',
        monthlyPrice: Number(planByName.get(parser.normalizeHeader(row.plan))?.price || 0),
        planAuthType: planByName.get(parser.normalizeHeader(row.plan))?.authType || 'pppoe',
        planProfile: planByName.get(parser.normalizeHeader(row.plan))?.mikrotik?.profile || '',
      })),
      errors: customerErrors,
    });
  }

  return {
    customers,
    report: {
      totalRows: customers.length,
      totalAccessRows: accessRows,
      validRows,
      duplicateRows,
      invalidRows,
      matchedPppoeRows,
      unmatchedPppoeRows: accessRows - matchedPppoeRows,
      importedRows: 0,
      skippedRows: duplicateRows + invalidRows,
      errors,
    },
    persistence: {
      supported: true,
      confirmationBlocked: false,
      reason: 'ClientAccess preserva plano, concentrador e credencial por acesso; Client mantém o acesso principal legado.',
    },
  };
}

module.exports = { groupCustomerAccessPreview };
