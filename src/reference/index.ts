// Reference tables (ASHRAE, UPC...) live as plain JSON files in this folder so they can be checked
// against the printed standard. This module loads them, validates their shape, and exposes lookups.
// To change a value, edit the .json file; nothing else in the app hard-codes table values.
import t61 from './ashrae-62.1-2022_table-6-1.json';
import t64 from './ashrae-62.1-2022_table-6-4.json';
import tpl from './room-templates.json';
import u6103 from './upc-2021-wa_table-610-3.json';
import u7021 from './upc-2021-wa_table-702-1.json';
import ucat from './plumbing-catalog_upc-2021-wa.json';

export type Verified = { by: string; date: string; note?: string } | null;
export type RefMeta = { id: string; standard: string; edition: string; table: string; title: string; notes?: string[]; units?: Record<string, string> };
export type RefFile<R> = { meta: RefMeta; rows: (R & { id: string; verified?: Verified })[] };

export type VentRow = { space: string; category: string; rp: number; ra: number; density: number };
export type ExhaustRow = { space: string; value: number; unit: 'cfm' | 'cfm/SF' | 'ACH' | 'cfm/fixture' };
export type TemplateRow = { name: string; vent: string | null; exhaust?: string; exhaustDesign?: { value: number; unit: ExhaustRow['unit'] }; lightingWsf: number; equipmentWsf: number };
export type Occupancy = 'private' | 'public' | 'assembly';
export type WsfuRow = { fixture: string; branch: string; private: number | null; public: number | null; assembly: number | null; hot: boolean };
export type DfuRow = { fixture: string; trap: string; private: number | null; public: number | null; assembly: number | null };
export type CatalogRow = { name: string; prefix: string; wsfu: string | null; dfu: string | null; symbol: string; size: { w: number; h: number } };

// Problems found while loading (shown in Settings > Reference data and in the browser console).
export const referenceIssues: string[] = [];

function load<R>(file: string, raw: unknown, check: (r: Record<string, unknown>) => string | null): RefFile<R> {
  const f = raw as RefFile<R>;
  if (!f || typeof f !== 'object' || !f.meta || !Array.isArray(f.rows)) { referenceIssues.push(`${file}: missing "meta" or "rows"`); return { meta: { id: file, standard: '?', edition: '?', table: '?', title: file }, rows: [] }; }
  const seen = new Set<string>();
  f.rows.forEach((r, i) => {
    if (!r.id) referenceIssues.push(`${file} row ${i + 1}: missing id`);
    else if (seen.has(r.id)) referenceIssues.push(`${file}: duplicate id "${r.id}"`);
    seen.add(r.id);
    const msg = check(r as unknown as Record<string, unknown>); if (msg) referenceIssues.push(`${file} "${r.id}": ${msg}`);
  });
  return f;
}
const num = (r: Record<string, unknown>, ...keys: string[]) => keys.find(k => r[k] !== null && typeof r[k] !== 'number') ? `${keys.join('/')} must be numbers or null` : null;

export const ventTable = load<VentRow>('ashrae-62.1-2022_table-6-1.json', t61, r => num(r, 'rp', 'ra', 'density'));
export const exhaustTable = load<ExhaustRow>('ashrae-62.1-2022_table-6-4.json', t64, r => num(r, 'value'));
export const templateTable = load<TemplateRow>('room-templates.json', tpl, r => num(r, 'lightingWsf', 'equipmentWsf'));
export const wsfuTable = load<WsfuRow>('upc-2021-wa_table-610-3.json', u6103, r => num(r, 'private', 'public', 'assembly'));
export const dfuTable = load<DfuRow>('upc-2021-wa_table-702-1.json', u7021, r => num(r, 'private', 'public', 'assembly'));
export const fixtureCatalog = load<CatalogRow>('plumbing-catalog_upc-2021-wa.json', ucat, () => null);

export const REFERENCE_FILES: { file: string; data: RefFile<object> }[] = [
  { file: 'ashrae-62.1-2022_table-6-1.json', data: ventTable }, { file: 'ashrae-62.1-2022_table-6-4.json', data: exhaustTable },
  { file: 'room-templates.json', data: templateTable }, { file: 'upc-2021-wa_table-610-3.json', data: wsfuTable },
  { file: 'upc-2021-wa_table-702-1.json', data: dfuTable }, { file: 'plumbing-catalog_upc-2021-wa.json', data: fixtureCatalog },
];

const byId = <R>(t: RefFile<R>) => new Map(t.rows.map(r => [r.id, r]));
export const ventRow = (id: string | null | undefined) => id ? byId(ventTable).get(id) : undefined;
export const exhaustRow = (id: string | null | undefined) => id ? byId(exhaustTable).get(id) : undefined;
export const wsfuRow = (id: string | null | undefined) => id ? byId(wsfuTable).get(id) : undefined;
export const dfuRow = (id: string | null | undefined) => id ? byId(dfuTable).get(id) : undefined;
export const catalogRow = (id: string | null | undefined) => id ? byId(fixtureCatalog).get(id) : undefined;

// Cross-file links must resolve.
templateTable.rows.forEach(t => {
  if (t.vent && !ventRow(t.vent)) referenceIssues.push(`room-templates.json "${t.id}": vent row "${t.vent}" not found`);
  if (t.exhaust && !exhaustRow(t.exhaust)) referenceIssues.push(`room-templates.json "${t.id}": exhaust row "${t.exhaust}" not found`);
});
fixtureCatalog.rows.forEach(c => {
  if (c.wsfu && !wsfuRow(c.wsfu)) referenceIssues.push(`plumbing catalog "${c.id}": WSFU row "${c.wsfu}" not found`);
  if (c.dfu && !dfuRow(c.dfu)) referenceIssues.push(`plumbing catalog "${c.id}": DFU row "${c.dfu}" not found`);
});
if (referenceIssues.length) console.warn('Reference data problems:\n' + referenceIssues.join('\n'));

export const sourceLabel = (m: RefMeta) => `${m.standard} ${m.edition} ${m.table}`;
export const isVerified = (r: { verified?: Verified }) => !!r.verified;
export const verifiedCount = (t: RefFile<object>) => t.rows.filter(isVerified).length;
