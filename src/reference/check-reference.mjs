#!/usr/bin/env node
// Checks the reference tables: shape, duplicate ids, broken links, and how many rows are verified.
//   node src/reference/check-reference.mjs            summary of every file
//   node src/reference/check-reference.mjs --csv FILE  print one table as CSV to compare with the book
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
const data = Object.fromEntries(files.map(f => [f, JSON.parse(readFileSync(join(dir, f), 'utf8'))]));
const args = process.argv.slice(2);

if (args[0] === '--csv') {
  const f = data[args[1]]; if (!f) { console.error(`No file ${args[1]}. Files: ${files.join(', ')}`); process.exit(1); }
  // Every column except nested objects (e.g. symbol size); "verified" is printed as "by date".
  const cols = [...new Set(f.rows.flatMap(r => Object.keys(r)))].filter(k => k === 'verified' || !f.rows.some(r => r[k] !== null && typeof r[k] === 'object'));
  const cell = v => v === null || v === undefined ? '' : typeof v === 'object' ? `${v.by} ${v.date}` : `"${String(v).replaceAll('"', '""')}"`;
  console.log(`# ${f.meta.standard} ${f.meta.edition} ${f.meta.table}: ${f.meta.title}`);
  console.log(cols.join(','));
  for (const r of f.rows) console.log(cols.map(c => cell(r[c])).join(','));
  process.exit(0);
}

let problems = 0;
const ids = {};
for (const [name, f] of Object.entries(data)) {
  if (!f.meta || !Array.isArray(f.rows)) { console.log(`✗ ${name}: missing meta or rows`); problems++; continue; }
  const seen = new Set();
  for (const r of f.rows) { if (!r.id) { console.log(`✗ ${name}: row without id`); problems++; } else if (seen.has(r.id)) { console.log(`✗ ${name}: duplicate id ${r.id}`); problems++; } seen.add(r.id); }
  ids[name] = seen;
  const v = f.rows.filter(r => r.verified).length;
  console.log(`${v === f.rows.length ? '✓' : '·'} ${name.padEnd(42)} ${f.meta.standard} ${f.meta.edition} ${f.meta.table}  ${v}/${f.rows.length} verified`);
}
const link = (file, row, field, target) => { const id = row[field]; if (id && !ids[target]?.has(id)) { console.log(`✗ ${file} "${row.id}": ${field} "${id}" not found in ${target}`); problems++; } };
for (const r of data['room-templates.json']?.rows ?? []) { link('room-templates.json', r, 'vent', 'ashrae-62.1-2022_table-6-1.json'); link('room-templates.json', r, 'exhaust', 'ashrae-62.1-2022_table-6-4.json'); }
for (const r of data['plumbing-catalog_upc-2021-wa.json']?.rows ?? []) { link('plumbing catalog', r, 'wsfu', 'upc-2021-wa_table-610-3.json'); link('plumbing catalog', r, 'dfu', 'upc-2021-wa_table-702-1.json'); }
console.log(problems ? `\n${problems} problem(s) found.` : '\nNo structural problems. Rows marked · still need checking against the printed tables.');
process.exit(problems ? 1 : 0);
