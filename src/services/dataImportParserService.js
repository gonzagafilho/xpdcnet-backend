const crypto = require('crypto');
const ApiError = require('../errors/ApiError');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 5000;

const FIELD_ALIASES = {
  fullName: ['nome', 'cliente', 'nome_cliente', 'razao_social', 'nome_razao_social'],
  document: ['cpf', 'cnpj', 'cpf_cnpj', 'documento', 'document'],
  whatsapp: ['whatsapp', 'celular', 'telefone_whatsapp', 'fone_whatsapp'],
  phone: ['telefone', 'fone', 'phone'],
  email: ['email', 'e_mail'],
  zip: ['cep', 'zip'],
  street: ['endereco', 'logradouro', 'rua'],
  number: ['numero', 'numero_endereco', 'num'],
  neighborhood: ['bairro'],
  city: ['cidade', 'municipio'],
  state: ['uf', 'estado'],
  plan: ['plano', 'plan', 'perfil'],
  contract: ['contrato', 'numero_contrato', 'contract'],
  pppoeUsername: ['login_pppoe', 'usuario_pppoe', 'pppoe', 'login', 'usuario'],
  pppoePassword: ['senha_pppoe', 'password_pppoe', 'senha'],
  concentrator: ['concentrador', 'servidor', 'pop'],
};

const TARGET_FIELDS = Object.keys(FIELD_ALIASES);

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function safeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u0000/g, '').trim().slice(0, 2000);
}

function decodeUpload(payload = {}) {
  if (typeof payload.contentText === 'string') {
    const buffer = Buffer.from(payload.contentText, 'utf8');
    if (buffer.length > MAX_FILE_BYTES) throw ApiError.badRequest('Arquivo excede o limite de 8 MB.');
    return buffer;
  }
  if (typeof payload.contentBase64 !== 'string' || !payload.contentBase64.trim()) {
    throw ApiError.badRequest('Envie contentBase64 ou contentText.');
  }
  const buffer = Buffer.from(payload.contentBase64, 'base64');
  if (!buffer.length) throw ApiError.badRequest('Arquivo vazio.');
  if (buffer.length > MAX_FILE_BYTES) throw ApiError.badRequest('Arquivo excede o limite de 8 MB.');
  return buffer;
}

function detectDelimiter(text) {
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  return [',', ';', '\t']
    .map((delimiter) => ({ delimiter, count: first.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseCsvMatrix(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.replace(/\r$/, ''));
  rows.push(row);
  return rows.filter((values) => values.some((value) => safeCell(value) !== ''));
}

function matrixToRows(matrix) {
  if (!matrix.length) throw ApiError.badRequest('Arquivo sem registros.');
  const rawHeaders = matrix[0].map((value, index) => safeCell(value) || `coluna_${index + 1}`);
  const headers = [];
  const used = new Set();
  for (const raw of rawHeaders) {
    let header = raw;
    let suffix = 2;
    while (used.has(header)) header = `${raw}_${suffix++}`;
    used.add(header);
    headers.push(header);
  }
  if (matrix.length - 1 > MAX_ROWS) throw ApiError.badRequest(`Arquivo excede o limite de ${MAX_ROWS} registros.`);
  const rows = matrix.slice(1).map((values, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => { record[header] = safeCell(values[index]); });
    return record;
  });
  return { headers, rows };
}

function sourceFromFilename(filename) {
  const lower = String(filename || '').trim().toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  if (lower.endsWith('.json')) return 'json';
  throw ApiError.badRequest('Formato não suportado. Use CSV nesta versão.');
}

function parseUpload(payload = {}) {
  const originalFilename = safeCell(payload.originalFilename || payload.filename).slice(0, 255);
  if (!originalFilename) throw ApiError.badRequest('originalFilename é obrigatório.');
  const source = sourceFromFilename(originalFilename);
  const buffer = decodeUpload(payload);
  if (source === 'xlsx') {
    throw ApiError.unprocessable(
      'XLSX ainda não está habilitado neste ambiente. Exporte a planilha como CSV para esta versão.',
      'XLSX_PARSER_UNAVAILABLE',
    );
  }
  if (source === 'json') throw ApiError.unprocessable('JSON está reservado para uma fase futura.', 'JSON_PARSER_UNAVAILABLE');
  const parsed = matrixToRows(parseCsvMatrix(buffer.toString('utf8').replace(/^\uFEFF/, '')));
  return {
    ...parsed,
    source,
    originalFilename,
    fileHash: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function detectColumnMapping(headers) {
  const mapping = {};
  const assigned = new Set();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const field = TARGET_FIELDS.find((candidate) => !assigned.has(candidate) && FIELD_ALIASES[candidate].includes(normalized));
    mapping[header] = field || '';
    if (field) assigned.add(field);
  }
  return mapping;
}

function normalizeMapping(headers, supplied) {
  const auto = detectColumnMapping(headers);
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return auto;
  const usedTargets = new Set();
  const out = {};
  for (const header of headers) {
    const target = String(supplied[header] || auto[header] || '');
    if (target && TARGET_FIELDS.includes(target) && !usedTargets.has(target)) {
      out[header] = target;
      usedTargets.add(target);
    } else out[header] = '';
  }
  return out;
}

function normalizeRecord(raw, mapping) {
  const row = { rowNumber: raw.__rowNumber };
  for (const [header, target] of Object.entries(mapping)) {
    if (target) row[target] = safeCell(raw[header]);
  }
  row.document = String(row.document || '').replace(/\D/g, '');
  row.whatsapp = String(row.whatsapp || '').replace(/\D/g, '');
  row.phone = String(row.phone || '').replace(/\D/g, '');
  row.zip = String(row.zip || '').replace(/\D/g, '');
  row.state = String(row.state || '').toUpperCase().slice(0, 2);
  row.pppoeUsername = String(row.pppoeUsername || '').trim().toLowerCase();
  row.email = String(row.email || '').trim().toLowerCase();
  return row;
}

function cpfValid(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(value[i]) * (length + 1 - i);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

function cnpjValid(value) {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const calc = (length) => {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(value[i]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calc(12) === Number(value[12]) && calc(13) === Number(value[13]);
}

function safePreviewRow(row, status, errors, planName, matchedPppoe) {
  return {
    rowNumber: row.rowNumber,
    fullName: row.fullName || '',
    document: row.document || '',
    whatsapp: row.whatsapp || '',
    phone: row.phone || '',
    email: row.email || '',
    plan: planName || row.plan || '',
    contract: row.contract || '',
    pppoeUsername: row.pppoeUsername || '',
    hasPppoePassword: Boolean(row.pppoePassword),
    concentrator: row.concentrator || '',
    status,
    matchedPppoe: Boolean(matchedPppoe),
    errors,
  };
}

module.exports = {
  FIELD_ALIASES,
  TARGET_FIELDS,
  MAX_ROWS,
  parseUpload,
  detectColumnMapping,
  normalizeMapping,
  normalizeRecord,
  documentValid: (value) => cpfValid(value) || cnpjValid(value),
  safePreviewRow,
  normalizeHeader,
};
