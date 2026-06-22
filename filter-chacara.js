#!/usr/bin/env node
const XLSX = require('xlsx');
const fs = require('fs');
const { createWriteStream } = require('fs');

const excelFile = '/home/servidor-dcnet/chatbot-dcinfinity/_cleanup_review_20260513-135617/clientes-1777133577.xlsx';
const workbook = XLSX.readFile(excelFile);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const allData = XLSX.utils.sheet_to_json(worksheet);

// Filter for CHACARRA only
const chacaraData = allData.filter(row => 
  String(row['Servidor'] || '').trim().toUpperCase() === 'CHACARRA'
);

console.log(`Total records: ${allData.length}`);
console.log(`CHACARRA records: ${chacaraData.length}`);
console.log(`SERVIDOR records: ${allData.filter(r => String(r['Servidor'] || '').trim().toUpperCase() === 'SERVIDOR').length}`);

// Map columns to CSV format expected by migration center
const csvHeaders = [
  'nome',
  'cpf_cnpj',
  'whatsapp',
  'telefone',
  'email',
  'cep',
  'endereco',
  'numero',
  'bairro',
  'cidade',
  'uf',
  'plano',
  'contrato',
  'login_pppoe',
  'senha_pppoe',
  'concentrador'
];

// Column mapping from Excel to CSV
const columnMap = {
  'nome': 'Nome',
  'cpf_cnpj': 'CPF/CNPJ',
  'whatsapp': 'Celular 1',
  'telefone': 'Celular 1',
  'email': 'E-mail',
  'cep': 'CEP',
  'endereco': 'Logradouro/Rua',
  'numero': 'Numero',
  'bairro': 'Bairro',
  'cidade': 'Cidade',
  'uf': 'Estado',
  'plano': 'Plano',
  'contrato': 'ID',
  'login_pppoe': 'Login',
  'senha_pppoe': 'Senha',
  'concentrador': 'Servidor'
};

// Create CSV content
let csvContent = csvHeaders.join(',') + '\n';

chacaraData.forEach(row => {
  const csvRow = [];
  
  csvHeaders.forEach(header => {
    const sourceColumn = columnMap[header];
    let value = row[sourceColumn] || '';
    
    // Handle special cases
    if (header === 'uf' && value) {
      value = String(value).trim().toUpperCase();
    }
    
    // Clean and escape CSV values
    value = String(value).trim();
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      value = `"${value.replace(/"/g, '""')}"`;
    }
    
    csvRow.push(value);
  });
  
  csvContent += csvRow.join(',') + '\n';
});

// Write to file
const outputPath = '/tmp/chacara-clientes-filtrados.csv';
fs.writeFileSync(outputPath, csvContent, 'utf-8');

console.log(`\n✓ Filtered CSV created: ${outputPath}`);
console.log(`✓ Total rows in CSV: ${chacaraData.length}`);

// Display sample
console.log('\nSample rows (first 3):');
console.log(csvHeaders.join(' | '));
console.log('-'.repeat(80));
chacaraData.slice(0, 3).forEach((row, i) => {
  const values = csvHeaders.map(h => row[columnMap[h]] || '');
  console.log(values.join(' | '));
});
