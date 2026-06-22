#!/usr/bin/env node
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load environment
require('dotenv').config({ path: '/home/servidor-dcnet/apps/xpdcnet-backend/.env' });

const JWT_SECRET = process.env.JWT_SECRET;
const API_BASE = 'http://localhost:3035';

if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET not configured');
  process.exit(1);
}

// Create admin JWT token
const adminToken = jwt.sign(
  {
    id: '6970baa13550919f068ce5b0',
    email: 'admin@dcnet.com.br',
    role: 'superadmin',
    tenantId: 'default'
  },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('✓ JWT Token generated');
console.log(`✓ Token (first 50 chars): ${adminToken.substring(0, 50)}...`);

// Read the filtered CSV
const csvPath = '/tmp/chacara-clientes-filtrados.csv';
const csvContent = fs.readFileSync(csvPath, 'utf-8');

console.log(`\n✓ CSV file loaded: ${csvPath}`);
console.log(`✓ CSV size: ${(csvContent.length / 1024).toFixed(2)} KB`);

// Function to call API
async function callApi(method, endpoint, data = null) {
  try {
    const config = {
      method,
      url: `${API_BASE}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'x-tenant': 'dcnet',
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`API Error (${method} ${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('\n=== ETAPA 2: UPLOAD AND PREVIEW ===\n');
    
    // Step 1: Get available targets (concentrators)
    console.log('1. Fetching available targets...');
    const targets = await callApi('GET', '/data-import/targets');
    console.log(`✓ Found ${targets.items.length} targets`);
    
    // Find CHACARA STARLINK concentrator
    const chacaraTarget = targets.items.find(t => 
      t.name.toUpperCase().includes('CHACARA') ||
      t.name.toUpperCase().includes('STARLINK')
    );
    
    if (!chacaraTarget) {
      console.error('ERROR: CHACARA STARLINK concentrator not found');
      console.log('Available targets:');
      targets.items.forEach(t => console.log(`  - ${t.name} (${t.host})`));
      process.exit(1);
    }
    
    console.log(`✓ Target: ${chacaraTarget.name} (${chacaraTarget.host})`);
    console.log(`✓ Node: ${chacaraTarget.node?.name || 'N/A'}`);
    
    // Step 2: Upload CSV and execute preview
    console.log('\n2. Uploading CSV and executing preview...');
    
    const previewPayload = {
      targetServerId: chacaraTarget.id,
      csvContent: csvContent,
      columnMapping: {
        'nome': 'fullName',
        'cpf_cnpj': 'document',
        'whatsapp': 'whatsapp',
        'telefone': 'phone',
        'email': 'email',
        'cep': 'zip',
        'endereco': 'street',
        'numero': 'number',
        'bairro': 'neighborhood',
        'cidade': 'city',
        'uf': 'state',
        'plano': 'plan',
        'contrato': 'contract',
        'login_pppoe': 'pppoeUsername',
        'senha_pppoe': 'pppoePassword',
        'concentrador': 'concentrator'
      }
    };
    
    const preview = await callApi('POST', '/data-import/customers/preview', previewPayload);
    
    console.log(`✓ Preview completed: ${preview.id}`);
    
    // Step 3: Show preview report
    console.log('\n=== ETAPA 3: PREVIEW REPORT ===\n');
    console.log(`Job ID: ${preview.id}`);
    console.log(`Status: ${preview.status}`);
    console.log(`Filename: ${preview.originalFilename}`);
    console.log(`Target: ${preview.target.serverName}`);
    console.log(`');
    
    console.log('\n📊 Validation Report:');
    console.log(`  totalRows: ${preview.report.totalRows}`);
    console.log(`  validRows: ${preview.report.validRows}`);
    console.log(`  duplicateRows: ${preview.report.duplicateRows}`);
    console.log(`  invalidRows: ${preview.report.invalidRows}`);
    console.log(`  matchedPppoeRows: ${preview.report.matchedPppoeRows}`);
    
    if (preview.report.invalidRows > 0 || preview.report.duplicateRows > 0) {
      console.log('\n⚠️  Errors found:');
      preview.report.errors.forEach(err => {
        console.log(`  Row ${err.row}, Field "${err.field}": ${err.message}`);
      });
    }
    
    console.log('\n📋 Preview Rows (first 5):');
    preview.previewRows.slice(0, 5).forEach(row => {
      console.log(`  - ${row.fullName} (${row.document}) | Status: ${row.status}`);
    });
    
    // Save preview report
    const reportPath = '/tmp/preview-report.json';
    fs.writeFileSync(reportPath, JSON.stringify({
      jobId: preview.id,
      timestamp: new Date().toISOString(),
      report: preview.report,
      target: preview.target,
      previewRowsCount: preview.previewRows.length
    }, null, 2));
    
    console.log(`\n✓ Preview report saved to: ${reportPath}`);
    
    // Save job ID for next step
    fs.writeFileSync('/tmp/import-job-id.txt', preview.id);
    console.log(`✓ Job ID saved for import confirmation`);
    
    if (preview.report.validRows === preview.report.totalRows && 
        preview.report.duplicateRows === 0 && 
        preview.report.invalidRows === 0) {
      console.log('\n✅ Preview is VALID - Ready for import!');
    } else {
      console.log('\n❌ Preview has issues - Review errors before importing');
    }
    
  } catch (error) {
    console.error('\nERROR:', error.message);
    process.exit(1);
  }
}

main();
