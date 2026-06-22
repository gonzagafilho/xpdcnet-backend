#!/usr/bin/env node
const XLSX = require('xlsx');
const fs = require('fs');

const excelFile = '/home/servidor-dcnet/chatbot-dcinfinity/_cleanup_review_20260513-135617/clientes-1777133577.xlsx';
const workbook = XLSX.readFile(excelFile);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON to inspect
const data = XLSX.utils.sheet_to_json(worksheet);

console.log('=== EXCEL FILE INSPECTION ===\n');
console.log(`Total rows: ${data.length}`);
console.log(`Headers: ${Object.keys(data[0]).join(', ')}\n`);

// Show first few rows
console.log('First 5 rows:');
data.slice(0, 5).forEach((row, i) => {
  console.log(`\nRow ${i + 1}:`);
  Object.entries(row).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
});

// Look for server/concentrator column
console.log('\n=== SEARCHING FOR SERVER/CONCENTRATOR COLUMN ===\n');
const headers = Object.keys(data[0]);
const serverCols = headers.filter(h => 
  h.toLowerCase().includes('server') || 
  h.toLowerCase().includes('concentrador') ||
  h.toLowerCase().includes('servidor')
);

if (serverCols.length > 0) {
  console.log(`Found server-related columns: ${serverCols.join(', ')}`);
  
  serverCols.forEach(col => {
    const values = new Map();
    data.forEach(row => {
      const val = String(row[col] || '').trim();
      if (val) {
        values.set(val, (values.get(val) || 0) + 1);
      }
    });
    
    console.log(`\n"${col}" unique values and counts:`);
    Array.from(values.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([val, count]) => {
        console.log(`  ${val}: ${count} customers`);
      });
  });
} else {
  console.log('No server-related columns found. All columns:');
  headers.forEach(h => console.log(`  - ${h}`));
}
