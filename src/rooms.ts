// Room data model, HVAC calculations, room templates and report columns.
// Shared by App.tsx (properties panel, CSV) and Reports.tsx.

export type Point = { x: number; y: number };

// ---- Units ----
export type OccUnit = 'people' | 'per1000' | 'sfPer';
export const OCC_UNITS: [OccUnit, string][] = [['people', 'people'], ['per1000', 'people / 1000 SF'], ['sfPer', 'SF / person']];
export type LoadUnit = 'W' | 'kW' | 'BTU/h' | 'MBH' | 'W/SF' | 'kW/SF';
export const LOAD_UNITS: LoadUnit[] = ['W', 'kW', 'BTU/h', 'MBH', 'W/SF', 'kW/SF'];
export type ExhUnit = 'cfm' | 'cfm/SF' | 'ACH' | 'cfm/fixture';
export const EXH_UNITS: ExhUnit[] = ['cfm', 'cfm/SF', 'ACH', 'cfm/fixture'];
export type SolveFor = 'supply' | 'return' | 'exhaust' | 'pressure';
export const SOLVE_MODES: [SolveFor, string][] = [['supply', 'Solve supply'], ['return', 'Solve return'], ['exhaust', 'Solve exhaust'], ['pressure', 'Solve pressure']];
export type PressureUnit = 'inwg' | 'Pa';
export const PA_PER_INWG = 249.0889;
export type Load = { id: string; name: string; value: number; unit: LoadUnit };

// ---- Mechanical equipment (drawn on the plan inside its room) ----
export type EquipMethod = 'air' | 'capacity' | 'oa';
export type Equip = {
  id: string; type: string; tag: string; method: EquipMethod;
  cools: boolean; coolCfm: number; coolLat: number; coolCap: number;                 // coolCap (BTU/h) for capacity-rated units
  heats: boolean; heatCfm: number; heatLat: number; heatEat: number; heatCap: number; // heatEat = air entering the heating coil
  oaPct: number;                                  // outdoor air fraction of the unit's supply (OA diffusers are always 100%)
  pos?: Point | null; rot?: number;               // centre on the plan (PDF points) and rotation (0 or 90°)
  size?: { w: number; h: number } | null;         // symbol size in feet (null = the type's default)
};
type EquipDefaults = Omit<Equip, 'id' | 'tag' | 'type' | 'pos' | 'rot' | 'size'>;
// primary: an AHU-fed terminal unit, so its airflow counts as primary air.
export type EquipType = { type: string; prefix: string; color: string; size: { w: number; h: number }; primary?: boolean; defaults: EquipDefaults };
const AIR: EquipDefaults = { method: 'air', cools: true, coolCfm: 0, coolLat: 55, coolCap: 0, heats: true, heatCfm: 0, heatLat: 90, heatEat: 55, heatCap: 0, oaPct: 100 };
export const OA_DIFFUSER = 'OA Diffuser';
export const EQUIP_TYPES: EquipType[] = [
  { type: 'VAV w/ Reheat', prefix: 'VAV', color: '#2563eb', size: { w: 4, h: 2 }, primary: true, defaults: { ...AIR } },
  { type: 'VAV (cooling only)', prefix: 'VAV', color: '#0284c7', size: { w: 4, h: 2 }, primary: true, defaults: { ...AIR, heats: false } },
  { type: 'Fan Coil', prefix: 'FCU', color: '#7c3aed', size: { w: 4, h: 2.5 }, defaults: { ...AIR, heatLat: 95, heatEat: 70, oaPct: 0 } },
  { type: OA_DIFFUSER, prefix: 'OA', color: '#16a34a', size: { w: 2, h: 2 }, defaults: { ...AIR, method: 'oa', heats: false, coolLat: 55, heatLat: 65, oaPct: 100 } },
  { type: 'Split / DX', prefix: 'AC', color: '#0891b2', size: { w: 3, h: 1 }, defaults: { ...AIR, heats: false, oaPct: 0 } },
  { type: 'CAV w/ Reheat', prefix: 'CAV', color: '#1d4ed8', size: { w: 4, h: 2 }, primary: true, defaults: { ...AIR } },
  { type: 'Unit Heater', prefix: 'UH', color: '#dc2626', size: { w: 2, h: 2 }, defaults: { ...AIR, cools: false, heatLat: 100, heatEat: 65, oaPct: 0 } },
  { type: 'Baseboard / Radiant', prefix: 'BB', color: '#ea580c', size: { w: 6, h: 0.75 }, defaults: { ...AIR, method: 'capacity', cools: false, oaPct: 0 } },
  { type: 'Other (rated capacity)', prefix: 'EQ', color: '#64748b', size: { w: 2, h: 2 }, defaults: { ...AIR, method: 'capacity', oaPct: 0 } },
];
export const equipType = (type: string) => EQUIP_TYPES.find(t => t.type === type) ?? EQUIP_TYPES[EQUIP_TYPES.length - 1];
export const equipSize = (e: Equip) => e.size ?? equipType(e.type).size;
export function newEquip(type: string, tag = ''): Equip {
  return { id: newId(), type, tag, ...equipType(type).defaults, pos: null, rot: 0, size: null };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeEquip(raw: any): Equip {
  const d = equipType(raw.type).defaults;
  return { ...d, ...raw, id: raw.id ?? newId(), tag: raw.tag ?? '', oaPct: typeof raw.oaPct === 'number' ? raw.oaPct : d.oaPct,
    method: raw.type === OA_DIFFUSER ? 'oa' : (raw.method ?? d.method), pos: raw.pos ?? null, rot: raw.rot ?? 0, size: raw.size ?? null };
}
// The airflow a unit delivers to the room (cooling airflow, or heating airflow for heat-only units).
export const equipSupply = (e: Equip) => e.method === 'capacity' ? 0 : e.method === 'oa' ? e.coolCfm : e.cools ? e.coolCfm : e.heats ? e.heatCfm : 0;

export type Room = {
  id: string; name: string; points: Point[]; cutouts?: Point[][]; height: number;
  template?: string | null;                     // id of the template last applied
  occupancy: { value: number; unit: OccUnit };  // either a head count or a density, never both
  rp: number; ra: number; ez: number;           // ASHRAE 62.1: cfm/person, cfm/SF, zone air distribution effectiveness
  loads: Load[];
  peopleSensible: number;                       // BTU/h per person, added to the cooling load
  // Room airflow balance. Not shown in the UI right now; kept so projects don't lose it.
  solveFor: SolveFor;
  supplyCfm: number; oaPct: number;             // outdoor air = supply × oaPct
  returnCfm: number; exhaustCfm: number;
  pressureInwg: number; pressureUnit: PressureUnit; leakageIn2: number;
  exhaustReq: { value: number; unit: ExhUnit; fixtures: number };
  // Heating & cooling
  coolSetpoint: number; heatSetpoint: number;   // °F
  heatingLoad: { value: number; unit: LoadUnit };
  equipment: Equip[];
  labelPos?: Point | null; labelSize?: number;  // label position/size in PDF points (null = automatic position)
};

export const BTUH_PER_W = 3.412142;
export const DEFAULT_LABEL_SIZE = 8;

export const areaPx = (pts: Point[]) => Math.abs(pts.reduce((sum, p, i) => {
  const next = pts[(i + 1) % pts.length];
  return sum + p.x * next.y - next.x * p.y;
}, 0)) / 2;
export const cutoutsOf = (r: Room) => r.cutouts ?? [];
export const netAreaPx = (r: Room) => areaPx(r.points) - cutoutsOf(r).reduce((s, c) => s + areaPx(c), 0);
export const fmt = (value: number) => Number.isFinite(value)
  ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
// Round for display in an input without float noise (e.g. 0.30000000000000004).
export const tidy = (v: number) => Number.isFinite(v) ? Number(v.toPrecision(10)) : 0;
export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Sensible heat factor (BTU/h per cfm·°F): 1.08 at sea level, scaled by air density at altitude.
export const sensibleFactor = (altitudeFt: number) => 1.08 * Math.pow(1 - 6.8754e-6 * Math.max(0, altitudeFt), 5.2559);
// Orifice flow through leakage paths (door undercuts, cracks): Q = 2610 · A(ft²) · √ΔP(in.wg), Cd ≈ 0.65.
export const ORIFICE_K = 2610;

// Lighting / equipment / other, from the load's name ("Lighting", "Lights", "Plug loads", "Equipment"...).
export type LoadCategory = 'lighting' | 'equipment' | 'other';
export const loadCategory = (name: string): LoadCategory =>
  /light|lamp|lumin/i.test(name) ? 'lighting' : /equip|plug|recept|computer|misc|appliance|process/i.test(name) ? 'equipment' : 'other';
// Convert a load to watts. Per-SF units need the net area (null if uncalibrated).
export function loadToW(value: number, unit: LoadUnit, area: number | null): number | null {
  switch (unit) {
    case 'W': return value; case 'kW': return value * 1000;
    case 'BTU/h': return value / BTUH_PER_W; case 'MBH': return value * 1000 / BTUH_PER_W;
    case 'W/SF': return area === null ? null : value * area; case 'kW/SF': return area === null ? null : value * 1000 * area;
  }
}
export function occupantsOf(o: Room['occupancy'], area: number | null): number | null {
  if (o.unit === 'people') return o.value;
  if (area === null) return null;
  return o.unit === 'per1000' ? o.value * area / 1000 : (o.value > 0 ? area / o.value : 0);
}
export function exhaustRequired(r: Room, area: number | null, volume: number | null): number | null {
  const { value, unit, fixtures } = r.exhaustReq;
  switch (unit) {
    case 'cfm': return value;
    case 'cfm/SF': return area === null ? null : value * area;
    case 'ACH': return volume === null ? null : value * volume / 60;
    case 'cfm/fixture': return value * fixtures;
  }
}

// Accepts current rooms and rooms saved by earlier versions of the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeRoom(raw: any): Room {
  const num = (v: unknown, d = 0) => typeof v === 'number' && Number.isFinite(v) ? v : d;
  // Earlier versions stored OA as cfm next to supply; now OA is a fraction of supply.
  let supplyCfm = num(raw.supplyCfm), oaPct = num(raw.oaPct, 100);
  if (raw.oaPct === undefined && typeof raw.oaCfm === 'number' && raw.oaCfm > 0) {
    if (supplyCfm >= raw.oaCfm && supplyCfm > 0) oaPct = raw.oaCfm / supplyCfm * 100;
    else { supplyCfm = raw.oaCfm; oaPct = 100; }
  }
  return {
    id: raw.id, name: raw.name ?? 'Room', points: raw.points ?? [], cutouts: raw.cutouts ?? [],
    height: num(raw.height, 10), template: raw.template ?? null,
    occupancy: raw.occupancy ?? { value: num(Number(raw.people)), unit: 'people' },
    rp: num(raw.rp), ra: num(raw.ra), ez: num(raw.ez, 1),
    loads: Array.isArray(raw.loads) ? raw.loads : [
      { id: newId(), name: 'Lighting', value: num(Number(raw.lightingW)), unit: 'W' },
      { id: newId(), name: 'Equipment', value: num(Number(raw.equipmentW)), unit: 'W' },
    ],
    peopleSensible: num(raw.peopleSensible, 250),
    solveFor: raw.solveFor ?? 'pressure',
    supplyCfm, oaPct, returnCfm: num(raw.returnCfm), exhaustCfm: num(raw.exhaustCfm),
    pressureInwg: num(raw.pressureInwg), pressureUnit: raw.pressureUnit ?? 'inwg', leakageIn2: num(raw.leakageIn2, 36),
    exhaustReq: { value: num(raw.exhaustReq?.value), unit: raw.exhaustReq?.unit ?? 'cfm', fixtures: num(raw.exhaustReq?.fixtures, 1) },
    coolSetpoint: num(raw.coolSetpoint, 75), heatSetpoint: num(raw.heatSetpoint, 70),
    heatingLoad: raw.heatingLoad ?? { value: 0, unit: 'BTU/h' },
    equipment: Array.isArray(raw.equipment) ? raw.equipment.map(normalizeEquip) : [],
    labelPos: raw.labelPos ?? null, labelSize: num(raw.labelSize, DEFAULT_LABEL_SIZE),
  };
}

// ---- Everything calculated for one room. Area-based values are null until the drawing is scaled. ----
export type EquipResult = { cool: number; heatToRoom: number; coil: number; oa: number; supply: number; ezWarning: boolean };
export type Metrics = {
  area: number | null; gross: number | null; cutouts: number | null; volume: number | null;
  occupants: number | null; vbz: number | null; voz: number | null;
  loadW: (number | null)[]; totalW: number | null; perimeter: number | null;
  lightW: number | null; equipW: number | null; otherW: number | null;
  // Airflow and outdoor air delivered by the room's equipment.
  // primaryAir: VAV/CAV boxes (max), primaryAirMin: their minimum (heating) airflow,
  // unitAir: fan coils, splits, unit heaters, oaDiffAir: dedicated OA diffusers.
  primaryAir: number; primaryAirMin: number; unitAir: number; oaDiffAir: number;
  supply: number; oa: number; achSupply: number | null; oaShort: boolean;
  // Heating & cooling (BTU/h)
  factor: number; coolingLoad: number | null; peopleBtuh: number | null; heatingLoad: number | null;
  equip: EquipResult[]; coolCap: number; heatCap: number; coilTotal: number; equipCoolCfm: number;
  coolingShort: boolean; heatingShort: boolean;
  cfmNeeded: number | null; designLat: number;  // cooling cfm needed at designLat to meet the load
};
export function metrics(r: Room, feetPerPoint: number | null, altitudeFt = 0): Metrics {
  const sf = (px: number) => feetPerPoint === null ? null : px * feetPerPoint * feetPerPoint;
  const area = sf(netAreaPx(r)), gross = sf(areaPx(r.points)), cutouts = sf(cutoutsOf(r).reduce((t, c) => t + areaPx(c), 0));
  const volume = area === null ? null : area * r.height;
  const occupants = occupantsOf(r.occupancy, area);
  const vbz = occupants === null || area === null ? null : r.rp * occupants + r.ra * area;
  const voz = vbz === null ? null : vbz / (r.ez || 1);
  const loadW = r.loads.map(l => loadToW(l.value, l.unit, area));
  const totalW = loadW.some(w => w === null) ? null : loadW.reduce<number>((t, w) => t + (w ?? 0), 0);
  const byCat = (c: LoadCategory) => { const ws = r.loads.map((l, i) => loadCategory(l.name) === c ? loadW[i] : 0); return ws.some(w => w === null) ? null : ws.reduce<number>((t, w) => t + (w ?? 0), 0); };
  const perimeter = feetPerPoint === null ? null : r.points.reduce((t, p, i) => { const q = r.points[(i + 1) % r.points.length]; return t + Math.hypot(q.x - p.x, q.y - p.y); }, 0) * feetPerPoint;

  // Heating & cooling. Cooling = sensible internal loads + people; heating load is entered.
  const factor = sensibleFactor(altitudeFt);
  const peopleBtuh = occupants === null ? null : occupants * r.peopleSensible;
  const coolingLoad = totalW === null || peopleBtuh === null ? null : totalW * BTUH_PER_W + peopleBtuh;
  const hW = loadToW(r.heatingLoad.value, r.heatingLoad.unit, area);
  const heatingLoad = hW === null ? null : hW * BTUH_PER_W;
  const equip = r.equipment.map((e): EquipResult => {
    if (e.method === 'capacity') return { cool: e.cools ? e.coolCap : 0, heatToRoom: e.heats ? e.heatCap : 0, coil: e.heats ? e.heatCap : 0, oa: 0, supply: 0, ezWarning: false };
    if (e.method === 'oa') return {
      // Tempered outdoor air: helps or hurts depending on its supply temperature (not clamped).
      cool: factor * e.coolCfm * (r.coolSetpoint - e.coolLat), heatToRoom: factor * e.coolCfm * (e.heatLat - r.heatSetpoint),
      coil: 0, oa: e.coolCfm, supply: e.coolCfm, ezWarning: false,
    };
    // Ventilation is judged at the unit's lowest airflow (a VAV's heating minimum, if lower).
    const minFlow = e.cools && e.heats && e.heatCfm > 0 ? Math.min(e.coolCfm, e.heatCfm) : equipSupply(e);
    return {
      cool: e.cools ? Math.max(0, factor * e.coolCfm * (r.coolSetpoint - e.coolLat)) : 0,
      heatToRoom: e.heats ? Math.max(0, factor * e.heatCfm * (e.heatLat - r.heatSetpoint)) : 0,
      coil: e.heats ? Math.max(0, factor * e.heatCfm * (e.heatLat - e.heatEat)) : 0,
      oa: minFlow * e.oaPct / 100, supply: equipSupply(e),
      // ASHRAE 62.1 Table 6-4: warm air ≥ 15 °F above space from the ceiling drops Ez to 0.8
      ezWarning: e.heats && e.heatCfm > 0 && e.heatLat - r.heatSetpoint >= 15,
    };
  });
  const sum = (f: (x: EquipResult) => number) => equip.reduce((t, x) => t + f(x), 0);
  const coolCap = sum(x => x.cool), heatCap = sum(x => x.heatToRoom), coilTotal = sum(x => x.coil);
  const supply = sum(x => x.supply), oa = sum(x => x.oa);
  let primaryAir = 0, primaryAirMin = 0, unitAir = 0, oaDiffAir = 0;
  r.equipment.forEach(e => {
    const q = equipSupply(e);
    if (e.method === 'oa') oaDiffAir += q;
    else if (equipType(e.type).primary) { primaryAir += q; primaryAirMin += e.cools && e.heats && e.heatCfm > 0 ? Math.min(e.coolCfm, e.heatCfm) : q; }
    else unitAir += q;
  });
  const equipCoolCfm = r.equipment.reduce((t, e) => t + (e.method !== 'capacity' && e.cools ? e.coolCfm : 0), 0);
  const firstAir = r.equipment.find(e => e.method === 'air' && e.cools);
  const designLat = firstAir ? firstAir.coolLat : 55;
  const dT = r.coolSetpoint - designLat;
  const cfmNeeded = coolingLoad === null || dT <= 0 ? null : coolingLoad / (factor * dT);
  return {
    area, gross, cutouts, volume, occupants, vbz, voz, loadW, totalW, perimeter,
    lightW: byCat('lighting'), equipW: byCat('equipment'), otherW: byCat('other'),
    primaryAir, primaryAirMin, unitAir, oaDiffAir,
    supply, oa, achSupply: volume ? supply * 60 / volume : null,
    oaShort: voz !== null && voz > 0 && oa < voz - 0.05,
    factor, coolingLoad, peopleBtuh, heatingLoad, equip, coolCap, heatCap, coilTotal, equipCoolCfm,
    // Only judged once equipment has been added: an undesigned room isn't flagged.
    coolingShort: r.equipment.length > 0 && coolingLoad !== null && coolingLoad > 0 && coolCap < coolingLoad - 0.5,
    heatingShort: r.equipment.length > 0 && heatingLoad !== null && heatingLoad > 0 && heatCap < heatingLoad - 0.5,
    cfmNeeded, designLat,
  };
}
export const roomHasIssue = (m: Metrics) => m.oaShort || m.coolingShort || m.heatingShort;
export const roomIssues = (m: Metrics) => [m.oaShort && 'OA short', m.coolingShort && 'Cooling short', m.heatingShort && 'Heating short'].filter(Boolean).join(', ');
export const fmtPressure = (inwg: number | null, unit: PressureUnit) => inwg === null ? '—'
  : unit === 'Pa' ? `${(inwg * PA_PER_INWG).toFixed(1)} Pa` : `${inwg.toFixed(3)} in.wg`;

// ---- Room templates ----
export type RoomTemplate = {
  id: string; name: string; builtin?: boolean;
  occupancy: { value: number; unit: OccUnit }; rp: number; ra: number; ez: number;
  loads: { name: string; value: number; unit: LoadUnit }[];
  exhaustReq: { value: number; unit: ExhUnit; fixtures: number };
};
const T = (id: string, name: string, density: number, rp: number, ra: number, lighting: number, equipment: number,
  exhaust: RoomTemplate['exhaustReq'] = { value: 0, unit: 'cfm', fixtures: 1 }): RoomTemplate => ({
  id, name, builtin: true, occupancy: { value: density, unit: 'per1000' }, rp, ra, ez: 1,
  loads: [{ name: 'Lighting', value: lighting, unit: 'W/SF' }, { name: 'Equipment', value: equipment, unit: 'W/SF' }],
  exhaustReq: exhaust,
});
// Starting points: occupancy density, Rp and Ra follow ASHRAE 62.1 Table 6-1 defaults;
// exhaust follows Table 6-4; lighting/equipment W/SF are typical design allowances.
// Always check against the code edition adopted for the project.
export const BUILTIN_TEMPLATES: RoomTemplate[] = [
  T('office', 'Office', 5, 5, 0.06, 0.65, 1.0),
  T('conference', 'Conference / Meeting', 50, 5, 0.06, 0.95, 0.5),
  T('reception', 'Reception', 30, 5, 0.06, 0.8, 0.5),
  T('lobby', 'Main Entry Lobby', 10, 5, 0.06, 0.8, 0.25),
  T('break', 'Break Room', 25, 5, 0.06, 0.6, 2.0),
  T('corridor', 'Corridor', 0, 0, 0.06, 0.4, 0),
  T('storage', 'Storage', 0, 0, 0.12, 0.4, 0),
  T('electrical', 'Electrical / Telecom', 0, 0, 0.06, 0.4, 0),
  T('classroom', 'Classroom (age 9+)', 35, 10, 0.12, 0.7, 0.5),
  T('lab', 'Science Lab (education)', 25, 10, 0.18, 1.0, 5.0, { value: 6, unit: 'ACH', fixtures: 1 }),
  T('toilet', 'Toilet Room (public)', 0, 0, 0, 0.65, 0, { value: 70, unit: 'cfm/fixture', fixtures: 1 }),
  T('janitor', 'Janitor / Trash', 0, 0, 0, 0.5, 0, { value: 1.0, unit: 'cfm/SF', fixtures: 1 }),
];
export function applyTemplate(r: Room, t: RoomTemplate): Room {
  return {
    ...r, template: t.id, occupancy: { ...t.occupancy }, rp: t.rp, ra: t.ra, ez: t.ez,
    loads: t.loads.map(l => ({ ...l, id: newId() })),
    exhaustReq: { ...t.exhaustReq, fixtures: t.exhaustReq.unit === 'cfm/fixture' && r.exhaustReq.unit === 'cfm/fixture' ? r.exhaustReq.fixtures : t.exhaustReq.fixtures },
  };
}
export function templateFromRoom(r: Room, name: string): RoomTemplate {
  return {
    id: `u-${newId()}`, name, occupancy: { ...r.occupancy }, rp: r.rp, ra: r.ra, ez: r.ez,
    loads: r.loads.map(({ name, value, unit }) => ({ name, value, unit })),
    exhaustReq: { ...r.exhaustReq },
  };
}
// A section still "matches" its template until one of its values is changed.
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
export const ashraeMatches = (r: Room, t: RoomTemplate) =>
  r.occupancy.unit === t.occupancy.unit && same(r.occupancy.value, t.occupancy.value) && same(r.rp, t.rp) && same(r.ra, t.ra) && same(r.ez, t.ez);
export const loadsMatch = (r: Room, t: RoomTemplate) =>
  r.loads.length === t.loads.length && r.loads.every((l, i) => l.name === t.loads[i].name && l.unit === t.loads[i].unit && same(l.value, t.loads[i].value));
export const airflowMatches = (r: Room, t: RoomTemplate) =>
  r.exhaustReq.unit === t.exhaustReq.unit && same(r.exhaustReq.value, t.exhaustReq.value);

// ---- Report columns ----
export type CellCtx = { tpl: (id?: string | null) => string };
export type Column = {
  id: string; label: string; group: string;
  get: (r: Room, m: Metrics, ctx: CellCtx) => number | string | null;
  dec?: number; sum?: boolean; flag?: (r: Room, m: Metrics) => boolean;
};
const perSF = (v: number | null, a: number | null) => v === null || !a ? null : v / a;
const occText = (r: Room) => `${tidy(r.occupancy.value)} ${OCC_UNITS.find(u => u[0] === r.occupancy.unit)![1]}`;
export const COLUMNS: Column[] = [
  // Room
  { id: 'name', label: 'Room', group: 'Room', get: r => r.name },
  { id: 'template', label: 'Template', group: 'Room', get: (r, _m, c) => c.tpl(r.template) },
  { id: 'gross', label: 'Gross SF', group: 'Room', get: (_r, m) => m.gross, sum: true },
  { id: 'cutouts', label: 'Cutouts SF', group: 'Room', get: (_r, m) => m.cutouts, sum: true },
  { id: 'area', label: 'SF', group: 'Room', get: (_r, m) => m.area, sum: true },
  { id: 'perimeter', label: 'Perimeter (LF)', group: 'Room', get: (_r, m) => m.perimeter, sum: true },
  { id: 'height', label: 'Ceiling Height (ft)', group: 'Room', get: r => r.height },
  { id: 'volume', label: 'Volume (CF)', group: 'Room', get: (_r, m) => m.volume, dec: 0, sum: true },
  { id: 'coolSet', label: 'Cooling Setpoint (°F)', group: 'Room', get: r => r.coolSetpoint },
  { id: 'heatSet', label: 'Heating Setpoint (°F)', group: 'Room', get: r => r.heatSetpoint },
  { id: 'status', label: 'Status', group: 'Room', get: (_r, m) => roomIssues(m) || 'OK', flag: (_r, m) => roomHasIssue(m) },
  // Ventilation
  { id: 'occInput', label: 'Occupancy (as entered)', group: 'Ventilation', get: occText },
  { id: 'people', label: 'People', group: 'Ventilation', get: (_r, m) => m.occupants, sum: true },
  { id: 'density', label: 'People / 1000 SF', group: 'Ventilation', get: (_r, m) => m.occupants === null || !m.area ? null : m.occupants / m.area * 1000 },
  { id: 'rp', label: 'cfm/person', group: 'Ventilation', get: r => r.rp, dec: 2 },
  { id: 'ra', label: 'cfm/SF', group: 'Ventilation', get: r => r.ra, dec: 2 },
  { id: 'ez', label: 'Ez', group: 'Ventilation', get: r => r.ez, dec: 2 },
  { id: 'vbz', label: 'Vbz (cfm)', group: 'Ventilation', get: (_r, m) => m.vbz, dec: 0, sum: true },
  { id: 'reqOA', label: 'Required OA (cfm)', group: 'Ventilation', get: (_r, m) => m.voz, dec: 0, sum: true },
  { id: 'provOA', label: 'Provided OA (cfm)', group: 'Ventilation', get: (_r, m) => m.oa, dec: 0, sum: true, flag: (_r, m) => m.oaShort },
  { id: 'oaMargin', label: 'OA Margin (cfm)', group: 'Ventilation', get: (_r, m) => m.voz === null ? null : m.oa - m.voz, dec: 0, sum: true, flag: (_r, m) => m.oaShort },
  { id: 'oaPerPerson', label: 'Provided OA cfm/person', group: 'Ventilation', get: (_r, m) => m.occupants ? m.oa / m.occupants : null },
  // Loads
  { id: 'lightW', label: 'Lighting (W)', group: 'Loads', get: (_r, m) => m.lightW, dec: 0, sum: true },
  { id: 'lightWSF', label: 'Lighting (W/SF)', group: 'Loads', get: (_r, m) => perSF(m.lightW, m.area), dec: 2 },
  { id: 'equipW', label: 'Equipment (W)', group: 'Loads', get: (_r, m) => m.equipW, dec: 0, sum: true },
  { id: 'equipWSF', label: 'Equipment (W/SF)', group: 'Loads', get: (_r, m) => perSF(m.equipW, m.area), dec: 2 },
  { id: 'otherW', label: 'Other Loads (W)', group: 'Loads', get: (_r, m) => m.otherW, dec: 0, sum: true },
  { id: 'loadW', label: 'Internal Load (W)', group: 'Loads', get: (_r, m) => m.totalW, dec: 0, sum: true },
  { id: 'loadDensity', label: 'Internal Load (W/SF)', group: 'Loads', get: (_r, m) => perSF(m.totalW, m.area), dec: 2 },
  { id: 'loadBtu', label: 'Internal Load (BTU/h)', group: 'Loads', get: (_r, m) => m.totalW === null ? null : m.totalW * BTUH_PER_W, dec: 0, sum: true },
  { id: 'peopleSens', label: 'People Sensible (BTU/h·person)', group: 'Loads', get: r => r.peopleSensible, dec: 0 },
  { id: 'peopleBtu', label: 'People Load (BTU/h)', group: 'Loads', get: (_r, m) => m.peopleBtuh, dec: 0, sum: true },
  { id: 'loadBreakdown', label: 'Load Breakdown', group: 'Loads', get: r => r.loads.map(l => `${l.name}: ${tidy(l.value)} ${l.unit}`).join('; ') || null },
  // Mechanical equipment
  { id: 'equipment', label: 'Equipment', group: 'Mechanical Equipment', get: r => r.equipment.map(e => e.tag || e.type).join(', ') || null },
  { id: 'equipCount', label: 'Units', group: 'Mechanical Equipment', get: r => r.equipment.length, dec: 0, sum: true },
  { id: 'primaryAir', label: 'Primary Air (cfm)', group: 'Mechanical Equipment', get: (_r, m) => m.primaryAir, dec: 0, sum: true },
  { id: 'primaryAirMin', label: 'Primary Air Min (cfm)', group: 'Mechanical Equipment', get: (_r, m) => m.primaryAirMin, dec: 0, sum: true },
  { id: 'unitAir', label: 'Fan Coil / Unit Air (cfm)', group: 'Mechanical Equipment', get: (_r, m) => m.unitAir, dec: 0, sum: true },
  { id: 'oaDiffAir', label: 'OA Diffuser Air (cfm)', group: 'Mechanical Equipment', get: (_r, m) => m.oaDiffAir, dec: 0, sum: true },
  { id: 'supply', label: 'Total Supply (cfm)', group: 'Mechanical Equipment', get: (_r, m) => m.supply, dec: 0, sum: true },
  { id: 'supplySF', label: 'Supply cfm/SF', group: 'Mechanical Equipment', get: (_r, m) => perSF(m.supply, m.area), dec: 2 },
  { id: 'achSupply', label: 'ACH Supply', group: 'Mechanical Equipment', get: (_r, m) => m.achSupply },
  { id: 'coolLoad', label: 'Cooling Load (BTU/h)', group: 'Mechanical Equipment', get: (_r, m) => m.coolingLoad, dec: 0, sum: true },
  { id: 'coolCap', label: 'Cooling Capacity (BTU/h)', group: 'Mechanical Equipment', get: (_r, m) => m.coolCap, dec: 0, sum: true, flag: (_r, m) => m.coolingShort },
  { id: 'coolMargin', label: 'Cooling Margin (BTU/h)', group: 'Mechanical Equipment', get: (_r, m) => m.coolingLoad === null ? null : m.coolCap - m.coolingLoad, dec: 0, sum: true, flag: (_r, m) => m.coolingShort },
  { id: 'coolTons', label: 'Cooling Capacity (tons)', group: 'Mechanical Equipment', get: (_r, m) => m.coolCap / 12000, dec: 2, sum: true },
  { id: 'equipCfm', label: 'Cooling cfm', group: 'Mechanical Equipment', get: (_r, m) => m.equipCoolCfm, dec: 0, sum: true, flag: (_r, m) => m.coolingShort },
  { id: 'cfmNeeded', label: 'Cooling cfm Required', group: 'Mechanical Equipment', get: (_r, m) => m.cfmNeeded, dec: 0, sum: true },
  { id: 'heatLoad', label: 'Heating Load (BTU/h)', group: 'Mechanical Equipment', get: (_r, m) => m.heatingLoad, dec: 0, sum: true },
  { id: 'heatCap', label: 'Heating Capacity (BTU/h)', group: 'Mechanical Equipment', get: (_r, m) => m.heatCap, dec: 0, sum: true, flag: (_r, m) => m.heatingShort },
  { id: 'heatMargin', label: 'Heating Margin (BTU/h)', group: 'Mechanical Equipment', get: (_r, m) => m.heatingLoad === null ? null : m.heatCap - m.heatingLoad, dec: 0, sum: true, flag: (_r, m) => m.heatingShort },
  { id: 'coil', label: 'Heating Coil (MBH)', group: 'Mechanical Equipment', get: (_r, m) => m.coilTotal / 1000, dec: 1, sum: true },
  { id: 'coilKw', label: 'Heating Coil (kW)', group: 'Mechanical Equipment', get: (_r, m) => m.coilTotal / BTUH_PER_W / 1000, dec: 1, sum: true },
];
export const COLUMN_BY_ID = new Map(COLUMNS.map(c => [c.id, c]));

export type ReportTemplate = { id: string; name: string; columns: string[]; builtin?: boolean };
export const BUILTIN_REPORTS: ReportTemplate[] = [
  { id: 'ventilation', name: 'Ventilation', builtin: true, columns: ['name', 'area', 'height', 'volume', 'people', 'rp', 'ra', 'reqOA', 'provOA', 'oaMargin', 'primaryAir', 'achSupply'] },
  { id: 'hvac', name: 'Mechanical Equipment', builtin: true, columns: ['name', 'area', 'equipment', 'primaryAir', 'primaryAirMin', 'unitAir', 'oaDiffAir', 'coolLoad', 'coolCap', 'heatLoad', 'heatCap', 'coil'] },
  { id: 'loads', name: 'Loads', builtin: true, columns: ['name', 'area', 'lightWSF', 'lightW', 'equipWSF', 'equipW', 'otherW', 'loadW', 'loadDensity', 'peopleBtu', 'coolLoad'] },
  { id: 'schedule', name: 'Room Schedule', builtin: true, columns: ['name', 'template', 'gross', 'cutouts', 'area', 'perimeter', 'height', 'volume'] },
  { id: 'roomdata', name: 'Room Data Summary', builtin: true, columns: ['name', 'template', 'area', 'volume', 'people', 'reqOA', 'provOA', 'lightWSF', 'equipWSF', 'coolLoad', 'coolCap', 'heatLoad', 'heatCap', 'primaryAir', 'status'] },
];
export const formatCell = (v: number | string | null, dec = 1) =>
  v === null ? '—' : typeof v === 'string' ? v : v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dec });
