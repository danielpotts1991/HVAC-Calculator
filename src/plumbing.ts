// Plumbing fixtures. A project keeps a short list of fixture types picked from the code catalog
// (src/reference/plumbing-catalog_*.json). Values are copied in when picked, so a finished project
// doesn't change if a reference file is corrected later; differsFromRef() shows what changed.
import type { Point } from './rooms';
import { type Occupancy, catalogRow, wsfuRow, dfuRow, wsfuTable, dfuTable, sourceLabel, isVerified } from './reference';

export type FixtureType = {
  id: string; catalogId: string; tag: string; name: string; occ: Occupancy;
  wsfu: number; cold: number; hot: number;   // water supply fixture units: total, and the cold / hot split
  dfu: number; trap: string; branch: string; // drainage fixture units, trap size, min. branch size (inches)
  symbol: string; size: { w: number; h: number }; note: string;
};
export type PlacedFixture = { id: string; typeId: string; pos: Point; rot: number };
export const OCCUPANCIES: [Occupancy, string][] = [['private', 'Private'], ['public', 'Public'], ['assembly', 'Assembly']];

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// What the reference tables say for a catalog fixture in a given occupancy.
export type RefValues = { wsfu: number | null; cold: number | null; hot: number | null; dfu: number | null; trap: string; branch: string; hasHot: boolean;
  wsfuSource: string | null; dfuSource: string | null; verified: boolean };
export function refValues(catalogId: string, occ: Occupancy): RefValues | null {
  const c = catalogRow(catalogId); if (!c) return null;
  const w = wsfuRow(c.wsfu), d = dfuRow(c.dfu);
  const total = w ? w[occ] : null, hasHot = !!w?.hot;
  // Table footnote: fixtures with hot and cold each carry 3/4 of the listed total on each system.
  return {
    wsfu: w ? total : 0, cold: total === null ? null : hasHot ? total * 0.75 : total, hot: total === null ? null : hasHot ? total * 0.75 : 0,
    dfu: d ? d[occ] : 0, trap: d?.trap ?? '', branch: w?.branch ?? '', hasHot,
    wsfuSource: w ? `${sourceLabel(wsfuTable.meta)}: ${w.fixture}` : null, dfuSource: d ? `${sourceLabel(dfuTable.meta)}: ${d.fixture}` : null,
    verified: (!w || isVerified(w)) && (!d || isVerified(d)),
  };
}
export function newFixtureType(catalogId: string, occ: Occupancy, existing: FixtureType[]): FixtureType | null {
  const c = catalogRow(catalogId), v = refValues(catalogId, occ); if (!c || !v) return null;
  const n = existing.filter(t => t.tag.startsWith(c.prefix + '-')).reduce((m, t) => Math.max(m, Number(t.tag.split('-').pop()) || 0), 0) + 1;
  return { id: newId(), catalogId, tag: `${c.prefix}-${n}`, name: c.name, occ, wsfu: v.wsfu ?? 0, cold: v.cold ?? 0, hot: v.hot ?? 0, dfu: v.dfu ?? 0,
    trap: v.trap, branch: v.branch, symbol: c.symbol, size: { ...c.size }, note: '' };
}
// Fields where the project's value no longer matches the reference table (for this occupancy).
export function differsFromRef(t: FixtureType): string[] {
  const v = refValues(t.catalogId, t.occ); if (!v) return ['not in catalog'];
  const out: string[] = [], ne = (a: number, b: number | null) => b !== null && Math.abs(a - b) > 1e-9;
  if (ne(t.wsfu, v.wsfu)) out.push('WSFU'); if (ne(t.cold, v.cold)) out.push('cold'); if (ne(t.hot, v.hot)) out.push('hot');
  if (ne(t.dfu, v.dfu)) out.push('DFU'); if (v.trap && t.trap !== v.trap) out.push('trap');
  return out;
}
export const resetToRef = (t: FixtureType): FixtureType => { const v = refValues(t.catalogId, t.occ);
  return v ? { ...t, wsfu: v.wsfu ?? 0, cold: v.cold ?? 0, hot: v.hot ?? 0, dfu: v.dfu ?? 0, trap: v.trap, branch: v.branch } : t; };

export type FixtureTotals = { count: number; wsfu: number; cold: number; hot: number; dfu: number; list: string };
export function fixtureTotals(fixtures: PlacedFixture[], types: FixtureType[]): FixtureTotals {
  const byId = new Map(types.map(t => [t.id, t])), counts = new Map<string, number>();
  const tot = { count: 0, wsfu: 0, cold: 0, hot: 0, dfu: 0 };
  for (const f of fixtures) { const t = byId.get(f.typeId); if (!t) continue;
    tot.count++; tot.wsfu += t.wsfu; tot.cold += t.cold; tot.hot += t.hot; tot.dfu += t.dfu; counts.set(t.tag, (counts.get(t.tag) ?? 0) + 1); }
  return { ...tot, list: [...counts].map(([tag, n]) => `${tag} ×${n}`).join(', ') };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeFixtureTypes = (raw: any): FixtureType[] => Array.isArray(raw) ? raw.map(t => ({ note: '', branch: '', ...t, size: t.size ?? { w: 1.5, h: 1.5 } })) : [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeFixtures = (raw: any): PlacedFixture[] => Array.isArray(raw) ? raw.filter(f => f && f.pos && f.typeId).map(f => ({ id: f.id ?? newId(), typeId: f.typeId, pos: f.pos, rot: f.rot ?? 0 })) : [];

// Fixture schedule: one row per project fixture type with its count and per-fixture / total units.
export type ScheduleRow = { t: FixtureType; count: number; cold: number; hot: number; dfu: number; wsfu: number;
  totCold: number; totHot: number; totDfu: number; totWsfu: number };
export const SCHEDULE_REPORT_ID = 'fixture-schedule';
export function fixtureSchedule(allFixtures: PlacedFixture[], types: FixtureType[]): ScheduleRow[] {
  const n = new Map<string, number>(); for (const f of allFixtures) n.set(f.typeId, (n.get(f.typeId) ?? 0) + 1);
  return types.map(t => { const c = n.get(t.id) ?? 0;
    return { t, count: c, cold: t.cold, hot: t.hot, dfu: t.dfu, wsfu: t.wsfu, totCold: c * t.cold, totHot: c * t.hot, totDfu: c * t.dfu, totWsfu: c * t.wsfu }; });
}
