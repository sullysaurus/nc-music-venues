#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '../src/data/venues_master.csv');
const BACKUP_PATH = path.join(__dirname, '../src/data/venues_backup_before_cleanup.csv');

console.log('🧹 Cleaning up venues CSV file...');

// Create backup first
console.log('📦 Creating backup...');
fs.copyFileSync(CSV_PATH, BACKUP_PATH);
console.log(`✅ Backup saved to: ${BACKUP_PATH}`);

// Load current data
const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
const venues = parse(csvContent, { columns: true, skip_empty_lines: true });

console.log(`📊 Loaded ${venues.length} venues`);

// Define columns to keep (in desired order)
const columnsToKeep = [
  'name',
  'location', 
  'address',
  'venue_type',
  'capacity',
  'contact_email',
  'contact_phone', 
  'website',
  'typical_genres'
];

console.log('🎯 Keeping columns:', columnsToKeep.join(', '));

// Create cleaned data with only needed columns
const cleanedVenues = venues.map(venue => {
  const cleaned = {};
  columnsToKeep.forEach(column => {
    cleaned[column] = venue[column] || '';
  });
  return cleaned;
});

// Convert back to CSV
const cleanedCsvContent = stringify(cleanedVenues, { 
  header: true,
  columns: columnsToKeep
});

// Save cleaned CSV
fs.writeFileSync(CSV_PATH, cleanedCsvContent);

console.log('✅ CSV cleanup complete!');
console.log(`📁 Original columns: ${Object.keys(venues[0] || {}).length}`);
console.log(`📁 New columns: ${columnsToKeep.length}`);
console.log(`🗑️  Removed columns: ${Object.keys(venues[0] || {}).length - columnsToKeep.length}`);

// Show removed columns
const originalColumns = Object.keys(venues[0] || {});
const removedColumns = originalColumns.filter(col => !columnsToKeep.includes(col));
if (removedColumns.length > 0) {
  console.log('🗑️  Removed:', removedColumns.join(', '));
}

console.log('\n🎉 Cleanup complete! Your CSV now only contains the columns your application actually uses.');