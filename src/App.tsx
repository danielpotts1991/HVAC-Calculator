import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Upload, MousePointer2, PenTool, Ruler, Trash2, Undo2, ZoomIn, ZoomOut, Download, FileText, Maximize, Save, FolderOpen, SaveAll, Scissors, Magnet, Settings, Eye, X, ChevronRight, ChevronsLeft, ChevronsRight, Plus, ClipboardList, Check, AirVent, Copy, RotateCw, RefreshCw } from 'lucide-react';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
import { type Point, type Room, type OccUnit, type LoadUnit, type Equip, type RoomTemplate, OCC_UNITS, LOAD_UNITS, EQUIP_TYPES, OA_DIFFUSER, newEquip, equipType, equipSize, equipSupply, BTUH_PER_W, DEFAULT_LABEL_SIZE,
  areaPx, cutoutsOf, netAreaPx, fmt, tidy, newId, normalizeRoom, metrics, sensibleFactor, roomHasIssue, BUILTIN_TEMPLATES, applyTemplate, templateFromRoom,
  ashraeMatches, loadsMatch, COLUMNS, type ReportTemplate } from './rooms';
import Reports from './Reports';

// Numeric input that lets you type freely ("0.", "", "1e") and only commits valid numbers.
function NumField({ value, onChange, step = 'any', min = 0, disabled, invalid, title }: { value: number; onChange: (v: number) => void; step?: string; min?: number; disabled?: boolean; invalid?: boolean; title?: string }) {
  const [text, setText] = useState(String(tidy(value)));
  const focused = useRef(false);
  // Show outside changes (unit switch, solved value, undo) even while focused, but never
  // overwrite a half-typed entry like "-" or "0." that doesn't parse yet.
  useEffect(() => {
    setText(t => { const n = Number(t); return !focused.current || (t !== '' && Number.isFinite(n) && tidy(n) !== tidy(value)) ? String(tidy(value)) : t; });
  }, [value]);
  return <input type="number" step={step} min={min} disabled={disabled} value={text} className={invalid ? 'bad' : undefined} title={title} aria-invalid={invalid || undefined}
    onFocus={() => { focused.current = true; }}
    onBlur={() => { focused.current = false; setText(String(tidy(value))); }}
    onChange={e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.max(min, n)); }} />;
}
// Collapsible section with a disclosure arrow.
function Section({ title, open, onToggle, children, aside, nested }: { title: string; open: boolean; onToggle: () => void; children: ReactNode; aside?: ReactNode; nested?: boolean }) {
  return <section className={`hvac-sec${open ? ' open' : ''}${nested ? ' nested' : ''}`}>
    <button className="hvac-sec-head" onClick={onToggle} aria-expanded={open}>
      <ChevronRight size={14} className="hvac-chev" /><span>{title}</span>{aside && <span className="hvac-sec-aside">{aside}</span>}
    </button>
    {open && <div className="hvac-sec-body">{children}</div>}
  </section>;
}
// Side bar that collapses to a thin vertical tab (Bluebeam-style).
function SidePanel({ side, title, open, onToggle, children }: { side: 'left' | 'right'; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const CloseIcon = side === 'left' ? ChevronsLeft : ChevronsRight;
  if (!open) return <aside className={`hvac-side hvac-side-${side} collapsed`}>
    <button className="hvac-side-tab" onClick={onToggle} title={`Show ${title}`}>{side === 'left' ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}<span>{title}</span></button>
  </aside>;
  return <aside className={`hvac-side hvac-side-${side}`}>
    <div className="hvac-side-head"><span>{title}</span><button className="hvac-btn icon-only" title={`Hide ${title}`} onClick={onToggle}><CloseIcon size={15} /></button></div>
    <div className="hvac-side-body">{children}</div>
  </aside>;
}
type Tool = 'select' | 'draw' | 'cutout' | 'equip' | 'calibrate';

// ---- Keyboard shortcuts (rebindable in Settings, saved in this browser) ----
type Action = 'select' | 'draw' | 'cutout' | 'equip' | 'calibrate' | 'fit' | 'snap';
const ACTIONS: { id: Action; label: string; key: string }[] = [
  { id: 'select', label: 'Select tool', key: 's' },
  { id: 'draw', label: 'Draw room tool', key: 'r' },
  { id: 'cutout', label: 'Cutout tool', key: 'c' },
  { id: 'equip', label: 'Place equipment tool', key: 'e' },
  { id: 'calibrate', label: 'Calibrate scale', key: 'k' },
  { id: 'fit', label: 'Fit page to window', key: 'f' },
  { id: 'snap', label: 'Toggle 15° snap', key: 'g' },
];
type Shortcuts = Record<Action, string>;
const DEFAULT_SHORTCUTS = Object.fromEntries(ACTIONS.map(a => [a.id, a.key])) as Shortcuts;
// Keys with fixed meanings that can't be reassigned.
const RESERVED_KEYS = ['escape', 'enter', 'backspace', 'delete', 'tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control', 'alt', 'meta'];
const keyLabel = (k: string) => !k ? '—' : k.length === 1 ? k.toUpperCase() : k;
type AppSettings = { shortcuts: Shortcuts; pdfOpacity: number; leftOpen: boolean; rightOpen: boolean; sections: Record<string, boolean>; roomTemplates: RoomTemplate[]; reports: ReportTemplate[];
  equipStyle: Record<string, { color: string; opacity: number }> }; // per equipment type: symbol colour and fill opacity
const DEFAULT_EQUIP_OPACITY = 0.15;
const DEFAULT_SECTIONS: Record<string, boolean> = { drawing: false, wall: true, room: true, ashrae: true, airflow: true, loads: true, hvac: true };
const SETTINGS_KEY = 'hvac-studio-settings';
function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { shortcuts: { ...DEFAULT_SHORTCUTS, ...(raw.shortcuts || {}) }, pdfOpacity: typeof raw.pdfOpacity === 'number' ? raw.pdfOpacity : 1,
      leftOpen: raw.leftOpen ?? true, rightOpen: raw.rightOpen ?? true, sections: { ...DEFAULT_SECTIONS, ...(raw.sections || {}) },
      roomTemplates: Array.isArray(raw.roomTemplates) ? raw.roomTemplates : [], reports: Array.isArray(raw.reports) ? raw.reports : [],
      equipStyle: raw.equipStyle && typeof raw.equipStyle === 'object' ? raw.equipStyle : {} };
  } catch { return { shortcuts: { ...DEFAULT_SHORTCUTS }, pdfOpacity: 1, leftOpen: true, rightOpen: true, sections: { ...DEFAULT_SECTIONS }, roomTemplates: [], reports: [], equipStyle: {} }; }
}
// True when the key press belongs to a text/number field rather than the app.
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
  (t instanceof HTMLInputElement && !['range', 'checkbox', 'button'].includes(t.type));

// Capacity vs. load bar for the equipment summary.
function Meter({ label, have, need, short }: { label: string; have: number; need: number | null; short: boolean }) {
  const pct = need && need > 0 ? Math.min(100, Math.max(0, have / need * 100)) : have > 0 ? 100 : 0;
  return <div className="hvac-meter">
    <div className="hvac-meter-top"><span>{label}</span><strong className={short ? 'hvac-bad-text' : undefined}>
      {Math.round(have).toLocaleString()}{need !== null && need > 0 ? ` / ${Math.round(need).toLocaleString()}` : ''} BTU/h</strong></div>
    <div className="hvac-meter-bar"><div className={short ? 'bad' : need && need > 0 ? 'ok' : ''} style={{ width: `${pct}%` }} /></div>
  </div>;
}
// Icon-only toolbar button; its name appears in a tooltip on hover.
function IconBtn({ tip, active, disabled, onClick, children }: { tip: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={`hvac-btn icon-only${active ? ' active' : ''}`} data-tip={tip} aria-label={tip} disabled={disabled} onClick={onClick}>{children}</button>;
}
type EdgeSel = { ring: number; index: number }; // ring -1 = room outline, k = cutout k

// Shared geometry and architectural-scale utilities.
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const scales = [
  ['1/16', '1/16" = 1\'-0"'],
  ['1/8', '1/8" = 1\'-0"'],
  ['3/16', '3/16" = 1\'-0"'],
  ['1/4', '1/4" = 1\'-0"'],
  ['3/8', '3/8" = 1\'-0"'],
  ['1/2', '1/2" = 1\'-0"'],
  ['custom', 'Custom calibration'],
] as const;
const scaleFeetPerPoint = (scale: string): number => {
  const [numerator, denominator] = scale.split('/').map(Number);
  const inchesPerFoot = denominator ? numerator / denominator : numerator;
  return 1 / (72 * inchesPerFoot);
};

// Direction constraints are applied to geometry, not to a grid.
// The first vertex is the fixed anchor; later vertices are adjusted.
const STEP = Math.PI / 12;
function snapDirection(a: Point, raw: Point): Point {
  const dx = raw.x - a.x, dy = raw.y - a.y;
  const theta = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
  const ux = Math.cos(theta), uy = Math.sin(theta);
  // Project onto the snapped direction: this keeps horizontal/vertical edges
  // aligned without increasing their length when the mouse is slightly off.
  const length = Math.max(0, dx * ux + dy * uy);
  return { x: a.x + length * ux, y: a.y + length * uy };
}
function cross(a: Point, b: Point) { return a.x * b.y - a.y * b.x; }
function segmentIntersection(a: Point, ad: Point, b: Point, bd: Point): Point | null {
  const det = cross(ad, bd);
  if (Math.abs(det) < 1e-7) return null;
  const t = cross({ x: b.x - a.x, y: b.y - a.y }, bd) / det;
  return { x: a.x + t * ad.x, y: a.y + t * ad.y };
}
// Close-snap: slide ONLY the last vertex along its incoming wall so the
// closing edge (last -> first) lands on a 15-degree multiple. The first
// vertex and every other corner stay fixed.
// Tries the two nearest 15-degree directions and keeps whichever moves the
// last vertex the least while still producing a valid polygon.
// Returns null if no valid adjustment exists (caller keeps the raw points).
function closeSnapped(points: Point[]): Point[] | null {
  const n = points.length;
  if (n < 3) return null;
  const first = points[0], previous = points[n - 2], last = points[n - 1];
  const incoming = { x: last.x - previous.x, y: last.y - previous.y };
  const len2 = incoming.x * incoming.x + incoming.y * incoming.y;
  if (len2 < 1e-9) return null;

  const base = Math.atan2(first.y - last.y, first.x - last.x) / STEP;
  const steps = Array.from(new Set([Math.floor(base), Math.ceil(base)]));
  let best: Point[] | null = null, bestMove = Infinity;
  for (const k of steps) {
    const dir = { x: Math.cos(k * STEP), y: Math.sin(k * STEP) };
    const hit = segmentIntersection(previous, incoming, first, dir);
    if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y)) continue; // parallel
    // Don't reverse or collapse the incoming wall.
    const t = ((hit.x - previous.x) * incoming.x + (hit.y - previous.y) * incoming.y) / len2;
    if (t <= 0.05) continue;
    // Closing edge must actually head from the new corner toward the first corner.
    if ((first.x - hit.x) * dir.x + (first.y - hit.y) * dir.y <= 1e-6) continue;
    const candidate = [...points.slice(0, -1).map(p => ({ ...p })), hit];
    if (!isSimplePolygon(candidate)) continue;
    const move = dist(hit, last);
    if (move < bestMove) { bestMove = move; best = candidate; }
  }
  return best;
}

function isSimplePolygon(points: Point[]): boolean {
  if (points.length < 3 || areaPx(points) < 1) return false;
  const n = points.length;
  function intersects(a: Point, b: Point, c: Point, d: Point) {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const cd = { x: d.x - c.x, y: d.y - c.y };
    const denom = cross(ab, cd);
    if (Math.abs(denom) < 1e-8) return false;
    const ac = { x: c.x - a.x, y: c.y - a.y };
    const t = cross(ac, cd) / denom, u = cross(ac, ab) / denom;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (intersects(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return false;
  }
  return true;
}

// ---- Rings, cutouts and edge editing ----
// A "ring" is a closed list of points. Ring -1 is a room's outline; ring k >= 0 is cutout k.
function properCross(a: Point, b: Point, c: Point, d: Point) {
  const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y };
  const denom = cross(ab, cd);
  if (Math.abs(denom) < 1e-8) return false;
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(ac, cd) / denom, u = cross(ac, ab) / denom;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}
function ringsCross(r1: Point[], r2: Point[]) {
  for (let i = 0; i < r1.length; i++) for (let j = 0; j < r2.length; j++)
    if (properCross(r1[i], r1[(i + 1) % r1.length], r2[j], r2[(j + 1) % r2.length])) return true;
  return false;
}
function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function onBoundary(p: Point, ring: Point[], tol = 0.5) {
  return ring.some((a, i) => distToSegment(p, a, ring[(i + 1) % ring.length]) <= tol);
}
function pointInRing(p: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// inner lies inside outer: no wall crossings, every corner inside or on the outline,
// and every wall's midpoint inside (catches a shape that bridges across a notch).
function ringInside(inner: Point[], outer: Point[]) {
  if (ringsCross(inner, outer)) return false;
  const ok = (p: Point) => pointInRing(p, outer) || onBoundary(p, outer);
  return inner.every((p, i) => {
    const q = inner[(i + 1) % inner.length];
    return ok(p) && ok({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  });
}
// A point guaranteed to be inside a ring (works for concave shapes too).
function interiorPoint(r: Point[]): Point {
  for (let i = 1; i < r.length - 1; i++) {
    const c = { x: (r[0].x + r[i].x + r[i + 1].x) / 3, y: (r[0].y + r[i].y + r[i + 1].y) / 3 };
    if (pointInRing(c, r) && !onBoundary(c, r, 1e-6)) return c;
  }
  return r[0];
}
// Two cutouts may touch but not overlap (identical or nested shapes count as overlap).
function ringsOverlap(a: Point[], b: Point[]) {
  if (ringsCross(a, b)) return true;
  const strictlyIn = (p: Point, r: Point[]) => pointInRing(p, r) && !onBoundary(p, r);
  return a.some(p => strictlyIn(p, b)) || b.some(p => strictlyIn(p, a))
    || strictlyIn(interiorPoint(a), b) || strictlyIn(interiorPoint(b), a);
}
// Move edge i of a ring along its own normal. Its two corners slide along the
// neighbouring walls, so those walls keep their angles (they just get longer/shorter).
function edgeNormal(ring: Point[], i: number): Point | null {
  const a = ring[i], b = ring[(i + 1) % ring.length], len = dist(a, b);
  return len < 1e-9 ? null : { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}
function offsetEdge(ring: Point[], i: number, arrow: Point, step: number): Point[] | null {
  const normal = edgeNormal(ring, i);
  if (!normal) return null;
  const along = arrow.x * normal.x + arrow.y * normal.y;
  if (Math.abs(along) < 0.3) return null; // arrow points along the wall: nothing to nudge
  return offsetEdgeBy(ring, i, step * Math.sign(along));
}
// Move edge i a signed distance along its normal; its corners slide along the neighbouring walls.
function offsetEdgeBy(ring: Point[], i: number, distance: number): Point[] | null {
  const n = ring.length;
  const a = ring[i], b = ring[(i + 1) % n];
  const len = dist(a, b);
  if (len < 1e-9) return null;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const normal = { x: -d.y, y: d.x };
  const off = { x: normal.x * distance, y: normal.y * distance };
  const a2 = { x: a.x + off.x, y: a.y + off.y }, b2 = { x: b.x + off.x, y: b.y + off.y };
  const prev = ring[(i - 1 + n) % n], next = ring[(i + 2) % n];
  const newA = segmentIntersection(prev, { x: a.x - prev.x, y: a.y - prev.y }, a2, d) ?? a2;
  const newB = segmentIntersection(next, { x: b.x - next.x, y: b.y - next.y }, b2, d) ?? b2;
  // Refuse moves that run a neighbouring wall backwards past its far corner.
  const fwd = (q: Point, from: Point, to: Point) => (q.x - from.x) * (to.x - from.x) + (q.y - from.y) * (to.y - from.y) > 1e-9;
  if (!fwd(newA, prev, a) || !fwd(newB, next, b)) return null;
  const out = ring.map(p => ({ ...p }));
  out[i] = { x: newA.x, y: newA.y };
  out[(i + 1) % n] = { x: newB.x, y: newB.y };
  // ...or that turn the shape inside out.
  const signed = (r: Point[]) => r.reduce((t, p, k) => { const q = r[(k + 1) % r.length]; return t + p.x * q.y - q.x * p.y; }, 0);
  if (Math.sign(signed(out)) !== Math.sign(signed(ring))) return null;
  return out;
}
// Label anchor: the sampled point inside the room's net area that is farthest from any
// wall or cutout edge. For a plain rectangle that is the centre; with a cutout or a
// room drawn inside the cutout, the label moves into the remaining floor area.
function labelPoint(room: Room): Point {
  const rings = [room.points, ...(room.cutouts ?? [])];
  const xs = room.points.map(p => p.x), ys = room.points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const N = 24;
  const centre = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
  const cands: { p: Point; d: number }[] = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = { x: minX + (maxX - minX) * (i + 0.5) / (N + 1), y: minY + (maxY - minY) * (j + 0.5) / (N + 1) };
    if (!pointInRing(p, room.points) || (room.cutouts ?? []).some(c => pointInRing(p, c))) continue;
    let d = Infinity;
    for (const r of rings) for (let k = 0; k < r.length; k++) d = Math.min(d, distToSegment(p, r[k], r[(k + 1) % r.length]));
    cands.push({ p, d });
  }
  if (!cands.length) return centre;
  // Among the roomiest spots (within 10% of the best), take the one nearest the centre,
  // so wide rooms get a centred label instead of the first equally-good spot found.
  const bestD = Math.max(...cands.map(c => c.d));
  return cands.filter(c => c.d >= bestD * 0.9).sort((u, v) => dist(u.p, centre) - dist(v.p, centre))[0].p;
}
// Things a new equipment symbol should keep clear of, each as a centre and radius (PDF points).
type Obstacle = { p: Point; r: number };
function labelObstacle(room: Room): Obstacle {
  const size = room.labelSize ?? DEFAULT_LABEL_SIZE;
  return { p: room.labelPos ?? labelPoint(room), r: Math.max(room.name.length, 9) * size * 0.3 + size * 0.5 };
}
// Clearance a symbol needs, in feet. OA diffusers carry their tag text below, wider than the square.
const equipRadiusFt = (e: Equip) => Math.hypot(equipSize(e).w, equipSize(e).h) / 2 * (e.method === 'oa' ? 2.2 : 1);
function equipObstacles(room: Room, ptPerFt: number, skip?: string): Obstacle[] {
  return room.equipment.flatMap(e => e.pos && e.id !== skip ? [{ p: e.pos, r: equipRadiusFt(e) * ptPerFt }] : []);
}
// Roomiest spot for a symbol of radius selfR: clear of walls, the label and other equipment.
function freeSpot(room: Room, obstacles: Obstacle[], selfR: number): Point {
  const xs = room.points.map(p => p.x), ys = room.points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rings = [room.points, ...(room.cutouts ?? [])];
  let best: Point | null = null, bestS = -Infinity; const N = 24;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = { x: minX + (maxX - minX) * (i + 0.5) / (N + 1), y: minY + (maxY - minY) * (j + 0.5) / (N + 1) };
    if (!pointInRing(p, room.points) || (room.cutouts ?? []).some(c => pointInRing(p, c))) continue;
    let s = Infinity;
    for (const r of rings) for (let k = 0; k < r.length; k++) s = Math.min(s, distToSegment(p, r[k], r[(k + 1) % r.length]) - selfR * 0.75);
    for (const o of obstacles) s = Math.min(s, dist(p, o.p) - o.r - selfR);
    if (s > bestS) { bestS = s; best = p; }
  }
  return best ?? labelPoint(room);
}
// Give equipment from older project files a position on the plan.
function placeMissingEquipment(list: Room[], ptPerFt: number): Room[] {
  return list.map(r => {
    if (!r.equipment.some(e => !e.pos)) return r;
    let room = r;
    for (const e of r.equipment) if (!e.pos) {
      const pos = freeSpot(room, [labelObstacle(room), ...equipObstacles(room, ptPerFt)], equipRadiusFt(e) * ptPerFt);
      room = { ...room, equipment: room.equipment.map(x => x.id === e.id ? { ...x, pos } : x) };
    }
    return room;
  });
}
// Shift a room and everything attached to it (cutouts, label, equipment).
function translateRoom(r: Room, dx: number, dy: number): Room {
  const mv = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return { ...r, points: r.points.map(mv), cutouts: (r.cutouts ?? []).map(c => c.map(mv)), labelPos: r.labelPos ? mv(r.labelPos) : r.labelPos,
    equipment: r.equipment.map(e => e.pos ? { ...e, pos: mv(e.pos) } : e) };
}
type Rect = { x0: number; y0: number; x1: number; y1: number };
const inRect = (p: Point, b: Rect) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
// Crossing selection: the room touches the box at all.
function ringTouchesRect(ring: Point[], b: Rect) {
  if (ring.some(p => inRect(p, b))) return true;
  const c = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  if (c.some(p => pointInRing(p, ring))) return true;
  return ringsCross(ring, c);
}
const ringPath = (r: Point[]) => 'M' + r.map(p => `${p.x},${p.y}`).join('L') + 'Z';
const fmtFeet = (feet: number) => {
  const totalIn = Math.round(feet * 12 * 4) / 4;
  const ft = Math.floor(totalIn / 12), inch = totalIn - ft * 12;
  const whole = Math.floor(inch), frac = ['', ' 1/4', ' 1/2', ' 3/4'][Math.round((inch - whole) * 4)];
  return `${ft}'-${whole}${frac}"`;
};
const bytesToBase64=(bytes:Uint8Array)=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
const base64ToBytes=(b64:string)=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
type ProjectFile={version:1;pdfName:string;pdfBase64:string|null;pageNumber:number;scale:string;customFeetPerPoint:number|null;altitudeFt?:number;rooms:Room[]};
type WritableHandle={name:string;createWritable:()=>Promise<{write:(data:string)=>Promise<void>;close:()=>Promise<void>}>};
type FilePickerWindow=Window & {showSaveFilePicker?:(opts:object)=>Promise<WritableHandle>;showOpenFilePicker?:(opts:object)=>Promise<Array<{getFile:()=>Promise<File>;name:string}>>};
export default function App(){
  const [pdf,setPdf]=useState<pdfjsLib.PDFDocumentProxy|null>(null);
  const [pdfName,setPdfName]=useState('No drawing loaded');
  const pdfBytesRef=useRef<Uint8Array<ArrayBuffer>|null>(null);
  const projectHandleRef=useRef<WritableHandle|null>(null);
  const [projectName,setProjectName]=useState('Untitled.hvac.json');
  const [dirty,setDirty]=useState(false);
  const lastSnapshotRef=useRef('');
  const initializedRef=useRef(false);
  const [pageNumber,setPageNumber]=useState(1);
  const [pageSize,setPageSize]=useState({width:900,height:650});
  const [zoom,setZoom]=useState(1);
  const [tool,setTool]=useState<Tool>('select');
  const [orthogonal,setOrthogonal]=useState(true);
  const [scale,setScale]=useState('1/8');
  const [customFeetPerPoint,setCustomFeetPerPoint]=useState<number|null>(null);
  const [altitudeFt,setAltitudeFt]=useState(0); // project site altitude, corrects the 1.08 sensible factor
  const [rooms,setRooms]=useState<Room[]>([]);
  const [draft,setDraft]=useState<Point[]>([]);
  const draftRef=useRef<Point[]>([]);
  useEffect(()=>{draftRef.current=draft;},[draft]);
  const [hover,setHover]=useState<Point|null>(null);
  const [rectStart,setRectStart]=useState<Point|null>(null);
  const [rectEnd,setRectEnd]=useState<Point|null>(null);
  const [calPoints,setCalPoints]=useState<Point[]>([]);
  const [selectedId,setSelectedIdRaw]=useState<string|null>(null);
  const [selectedEdge,setSelectedEdge]=useState<EdgeSel|null>(null);
  // Selecting a room (or nothing) always clears any edge selection.
  const [labelSel,setLabelSel]=useState(false); // the selected room's label is selected (drag / resize / arrows)
  // Selected equipment symbol (always inside the selected room).
  const [selectedEquip,setSelectedEquip]=useState<string|null>(null);
  const [hoverEquip,setHoverEquip]=useState<string|null>(null);
  const [placeType,setPlaceType]=useState(EQUIP_TYPES[0].type);
  const equipDragRef=useRef<{roomId:string;id:string;start:Point;startPos:Point;pushed:boolean}|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null|undefined>(undefined); // while dragging: room id under the symbol, null = outside any room
  const clipboardRef=useRef<Equip|null>(null);
  const cardRefs=useRef(new Map<string,HTMLDivElement>());
  // Hold space to pan with the left mouse button.
  const [spaceHeld,setSpaceHeld]=useState(false);const spaceRef=useRef(false);
  const [panning,setPanning]=useState(false);
  // Multi-selection of rooms; selectedId is the primary (last clicked) one shown in the properties panel.
  const [selIds,setSelIds]=useState<string[]>([]);
  const [marquee,setMarquee]=useState<{a:Point;b:Point}|null>(null);
  const marqueeRef=useRef<{start:Point;add:boolean}|null>(null);
  const moveDragRef=useRef<{ids:string[];start:Point;orig:Map<string,Room>;pushed:boolean;dx:number;dy:number;clicked:string;collapse:boolean}|null>(null);
  const setSelection=(ids:string[],primary:string|null)=>{setSelIds(ids);setSelectedIdRaw(primary);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);};
  const setSelectedId=(id:string|null)=>setSelection(id?[id]:[],id);
  // Label drag / resize in progress. history is pushed once, on the first real movement.
  const edgeDragRef=useRef<{roomId:string;ring:number;index:number;startRing:Point[];start:Point;normal:Point;pushed:boolean;dist:number}|null>(null);
  const labelDragRef=useRef<{mode:'move'|'size';id:string;start:Point;startPos:Point;startSize:number;center:Point;pushed:boolean}|null>(null);
  const labelRefs=useRef(new Map<string,SVGTextElement>());
  const [labelBox,setLabelBox]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  // Room-level undo history (Ctrl/Cmd+Z). Each entry is the rooms list before a change.
  const historyRef=useRef<Room[][]>([]);
  const pushHistory=()=>{historyRef.current.push(rooms);if(historyRef.current.length>200)historyRef.current.shift();};
  const [message,setMessage]=useState('Import a PDF to begin.');
  // Sharp rendering: the base canvas holds the whole page at screen resolution (zoom 1);
  // the detail canvas re-renders just the visible part at the current zoom once zooming/panning settles.
  const pageRef=useRef<pdfjsLib.PDFPageProxy|null>(null);
  const detailRef=useRef<HTMLCanvasElement>(null);
  const detailTaskRef=useRef<{cancel:()=>void}|null>(null);
  const detailTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const movingTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const replaceRef=useRef<HTMLInputElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null),svgRef=useRef<SVGSVGElement>(null),fileRef=useRef<HTMLInputElement>(null),scrollRef=useRef<HTMLElement>(null);
  const panRef=useRef<{x:number;y:number;offsetX:number;offsetY:number}|null>(null);
  const offsetRef=useRef({x:20,y:20});
  const zoomLabelTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const zoomRef=useRef(1);
  const rectRef=useRef<Point|null>(null);
  // First press of the Draw/Cutout tool: becomes a rectangle if dragged, or the first polygon corner if released in place.
  const pressRef=useRef<{p:Point;x:number;y:number;dragging:boolean}|null>(null);
  const [settings,setSettings]=useState<AppSettings>(loadSettings);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [reportsOpen,setReportsOpen]=useState(false);
  const [tplChoice,setTplChoice]=useState('');
  const [capturing,setCapturing]=useState<Action|null>(null);
  const [captureNote,setCaptureNote]=useState('');
  useEffect(()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{/* storage unavailable */}},[settings]);
  const sc=(a:Action)=>keyLabel(settings.shortcuts[a]);
  const secOpen=(k:string)=>settings.sections[k]??true;
  const allTemplates=[...BUILTIN_TEMPLATES,...settings.roomTemplates];
  const findTemplate=(id?:string|null)=>id?allTemplates.find(t=>t.id===id):undefined;
  const templateName=(id?:string|null)=>findTemplate(id)?.name??'Custom';
  const mOf=(r:Room)=>metrics(r,feetPerPoint,altitudeFt);
  const styleOf=(type:string)=>settings.equipStyle[type]??{color:equipType(type).color,opacity:DEFAULT_EQUIP_OPACITY};
  // The template picker follows the selected room.
  useEffect(()=>{setTplChoice(rooms.find(r=>r.id===selectedId)?.template??'');},[selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  function applyTemplateTo(room:Room,id:string){
    const t=findTemplate(id);if(!t)return;
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?applyTemplate(r,t):r));
    setMessage(`Applied "${t.name}" to ${room.name}. Values are starting points; verify against the adopted code.`);
  }
  function saveRoomAsTemplate(room:Room){
    const name=window.prompt('Template name:',room.name);if(!name?.trim())return;
    const t=templateFromRoom(room,name.trim());
    setSettings(st=>({...st,roomTemplates:[...st.roomTemplates,t]}));
    pushHistory();updateRoom({template:t.id},room.id);setTplChoice(t.id);
    setMessage(`Saved template "${t.name}". It's available in every project in this browser.`);
  }
  function deleteRoomTemplate(id:string){
    const t=findTemplate(id);if(!t||t.builtin||!window.confirm(`Delete the template "${t.name}"?`))return;
    setSettings(st=>({...st,roomTemplates:st.roomTemplates.filter(x=>x.id!==id)}));setTplChoice('');
  }
  const toggleSec=(k:string)=>setSettings(st=>({...st,sections:{...st.sections,[k]:!(st.sections[k]??true)}}));
  // Measure the selected label so the selection box and resize handle fit it exactly.
  useLayoutEffect(()=>{
    const el=labelSel&&selectedId?labelRefs.current.get(selectedId):null;
    const b=el?el.getBBox():null;
    const next=b?{x:b.x,y:b.y,width:b.width,height:b.height}:null;
    setLabelBox(prev=>JSON.stringify(prev)===JSON.stringify(next)?prev:next);
  });
  const lastClickRef=useRef<{t:number;x:number;y:number}|null>(null);
  const worldRef=useRef<HTMLDivElement>(null),sheetRef=useRef<HTMLDivElement>(null);
  const selected=rooms.find(r=>r.id===selectedId);
  const feetPerPoint=scale==='custom'?customFeetPerPoint:scaleFeetPerPoint(scale);
  const sf=(px:number)=>feetPerPoint===null?null:px*feetPerPoint*feetPerPoint;
  const roomArea=(r:Room)=>sf(netAreaPx(r)); // net = outline minus cutouts
  // Nudge step in PDF points: 1" (Shift: 1'-0"). Uncalibrated: 1 pt (Shift: 12 pt).
  // New labels: about 1 ft tall in real-world terms, kept between 4 and 14 PDF points.
  const defaultLabelSize=()=>feetPerPoint===null?DEFAULT_LABEL_SIZE:Math.max(4,Math.min(14,Math.round(1/feetPerPoint*2)/2));
  const nudgeStep=(big:boolean)=>feetPerPoint===null?(big?12:1):(big?1:1/12)/feetPerPoint;

  useEffect(()=>{
    if(!pdf||!canvasRef.current)return;
    let cancelled=false;let task:ReturnType<pdfjsLib.PDFPageProxy['render']>|undefined;
    pageRef.current=null;if(detailRef.current)detailRef.current.style.display='none';
    (async()=>{const page=await pdf.getPage(pageNumber);const vp=page.getViewport({scale:1});if(cancelled)return;
      setPageSize({width:vp.width,height:vp.height});const canvas=canvasRef.current;if(!canvas)return;
      const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(vp.width*ratio);canvas.height=Math.round(vp.height*ratio);
      canvas.style.width=`${vp.width}px`;canvas.style.height=`${vp.height}px`;
      const ctx=canvas.getContext('2d');if(!ctx)return;
      task=page.render({canvasContext:ctx,canvas,viewport:page.getViewport({scale:ratio})});
      try{await task.promise;}catch(e){if(!cancelled)console.error(e);}
      if(!cancelled){pageRef.current=page;scheduleDetail();}
    })().catch(console.error);
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>{detailTaskRef.current?.cancel();if(detailTimerRef.current)clearTimeout(detailTimerRef.current);if(movingTimerRef.current)clearTimeout(movingTimerRef.current);},[]);
  useEffect(()=>{const onResize=()=>scheduleDetail();window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  function scheduleDetail(){
    if(detailTimerRef.current)clearTimeout(detailTimerRef.current);
    detailTimerRef.current=setTimeout(()=>{detailTimerRef.current=null;void renderDetail();},160);
  }
  async function renderDetail(){
    const page=pageRef.current,out=detailRef.current,view=scrollRef.current;if(!page||!out||!view)return;
    const dpr=Math.min(window.devicePixelRatio||1,3),base=Math.min(window.devicePixelRatio||1,2),z=zoomRef.current;
    if(z*dpr<=base*1.05){out.style.display='none';return;} // the base canvas is already sharp enough
    const {x:ox,y:oy}=offsetRef.current,pvp=page.getViewport({scale:1}),pw=pvp.width,ph=pvp.height;
    // Visible part of the page (page units) plus a margin so short pans stay sharp.
    let x0=-ox/z,y0=-oy/z,x1=(view.clientWidth-ox)/z,y1=(view.clientHeight-oy)/z;
    const mx=(x1-x0)*0.15,my=(y1-y0)*0.15;
    x0=Math.max(0,x0-mx);y0=Math.max(0,y0-my);x1=Math.min(pw,x1+mx);y1=Math.min(ph,y1+my);
    if(x1<=x0||y1<=y0){out.style.display='none';return;}
    const w=x1-x0,h=y1-y0;
    const sc=Math.min(z*dpr,Math.sqrt(24e6/(w*h)),16000/Math.max(w,h)); // keep the bitmap a sane size
    const tmp=document.createElement('canvas');tmp.width=Math.ceil(w*sc);tmp.height=Math.ceil(h*sc);
    const ctx=tmp.getContext('2d');if(!ctx)return;
    detailTaskRef.current?.cancel();
    const task=page.render({canvasContext:ctx,canvas:tmp,viewport:page.getViewport({scale:sc,offsetX:-x0*sc,offsetY:-y0*sc})});
    detailTaskRef.current=task;
    try{await task.promise;}catch{return;} // cancelled by a newer render
    if(detailTaskRef.current!==task)return;
    out.width=tmp.width;out.height=tmp.height;out.getContext('2d')?.drawImage(tmp,0,0);
    Object.assign(out.style,{display:'block',left:`${x0}px`,top:`${y0}px`,width:`${w}px`,height:`${h}px`});
  }

  const snapshot=JSON.stringify({pdfName,pageNumber,scale,customFeetPerPoint,altitudeFt,rooms});
  useEffect(()=>{
    if(!initializedRef.current){initializedRef.current=true;lastSnapshotRef.current=snapshot;return;}
    setDirty(snapshot!==lastSnapshotRef.current);
  },[snapshot]);
  useEffect(()=>{if(!dirty)return;try{localStorage.setItem('hvac-studio-recovery',JSON.stringify({version:1,pdfName,pageNumber,scale,customFeetPerPoint,altitudeFt,rooms}));}catch{/* storage unavailable */}},[dirty,snapshot]);
  useEffect(()=>()=>{if(zoomLabelTimerRef.current!==null)clearTimeout(zoomLabelTimerRef.current);},[]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{
    // Settings dialog: capture a new shortcut key, or just let Escape close it.
    if(capturing){
      e.preventDefault();
      if(e.key==='Escape'){setCapturing(null);setCaptureNote('');return;}
      if(e.metaKey||e.ctrlKey||e.altKey)return;
      const k=e.key.length===1?e.key.toLowerCase():e.key;
      if(RESERVED_KEYS.includes(k.toLowerCase())||!(k.length===1||/^F\d{1,2}$/.test(k))){setCaptureNote(`${keyLabel(k)} is reserved. Pick a letter, number or F-key.`);return;}
      const other=ACTIONS.find(a=>a.id!==capturing&&settings.shortcuts[a.id]===k);
      setSettings(st=>({...st,shortcuts:{...st.shortcuts,[capturing]:k,...(other?{[other.id]:st.shortcuts[capturing]}:{})}}));
      setCaptureNote(other?`${keyLabel(k)} was used by "${other.label}" — swapped, it is now ${keyLabel(settings.shortcuts[capturing])}.`:'');
      setCapturing(null);return;
    }
    if(settingsOpen){if(e.key==='Escape')setSettingsOpen(false);return;}
    if(reportsOpen){if(e.key==='Escape'&&!isTyping(e.target))setReportsOpen(false);return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void saveProject();return;}
    if(isTyping(e.target))return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}
    const mod=e.metaKey||e.ctrlKey,k0=e.key.toLowerCase();
    // Hold space to pan (handled in onPanDown); never let it press a focused button.
    if(e.key===' '&&!mod){e.preventDefault();if(document.activeElement instanceof HTMLButtonElement)document.activeElement.blur();
      if(!spaceRef.current){spaceRef.current=true;setSpaceHeld(true);}return;}
    // Equipment: duplicate, copy, paste (paste goes into the room under the cursor).
    if(mod&&k0==='a'){e.preventDefault();if(tool!=='select')switchTool('select');const ids=rooms.map(r=>r.id);setSelection(ids,ids[ids.length-1]??null);
      setMessage(`All ${ids.length} rooms selected. Drag any of them, or use the arrow keys, to move them together.`);return;}
    const curEquip=selected?.equipment.find(x=>x.id===selectedEquip);
    if(mod&&k0==='d'&&curEquip&&selected){e.preventDefault();const c=cloneInto(curEquip,selected);setMessage(`Duplicated ${curEquip.tag||curEquip.type} as ${c.tag}.`);return;}
    if(mod&&k0==='c'&&curEquip){clipboardRef.current={...curEquip};setMessage(`Copied ${curEquip.tag||curEquip.type}. Point at a room and press Ctrl/Cmd+V to paste.`);return;}
    if(mod&&k0==='v'&&clipboardRef.current){
      const under=hover?roomAt(hover):undefined,target=under??selected;
      if(!target){setMessage('Point at a room (or select one) to paste equipment into it.');return;}
      e.preventDefault();const c=cloneInto(clipboardRef.current,target,under?hover!:undefined);setMessage(`Pasted ${c.tag} into ${target.name}.`);return;
    }
    if(e.target instanceof HTMLButtonElement&&e.key==='Enter')return;
    if(e.key==='Escape'&&!(selectedEdge||labelSel||selectedEquip||draftRef.current.length||tool!=='select'))setSelectedId(null);
    if(e.key==='Escape'){setDraft([]);setRectStart(null);setRectEnd(null);rectRef.current=null;pressRef.current=null;setCalPoints([]);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);
      if(tool==='equip')switchTool('select');}
    if(e.key==='Backspace'||e.key==='Delete'){
      e.preventDefault();
      if(draftRef.current.length){setDraft(v=>v.slice(0,-1));return;}
      if(tool==='select'&&selected&&selectedEquip){removeEquip(selected.id,selectedEquip);return;}
      if(tool==='select'&&selected&&selectedEdge&&selectedEdge.ring>=0){deleteCutout(selectedEdge.ring);return;}
      if(e.key==='Delete'&&tool==='select'&&(selected||selIds.length))deleteRoom();
      return;
    }
    if(e.key==='Enter'&&(tool==='draw'||tool==='cutout')){e.preventDefault();finishRoom();}
    if(tool==='select'&&selected&&selectedEquip&&e.key.startsWith('Arrow')&&!(e.target instanceof HTMLInputElement)){e.preventDefault();nudgeEquip(e.key,e.shiftKey);return;}
    // Selected label: arrows move it (1 pt, Shift 10 pt); + / - resize it.
    if(tool==='select'&&selected&&labelSel&&!(e.target instanceof HTMLInputElement)){
      const d={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];
      if(d){e.preventDefault();const st=e.shiftKey?10:1,cur=selected.labelPos??labelPoint(selected);
        pushHistory();updateRoom({labelPos:{x:cur.x+d[0]*st,y:cur.y+d[1]*st}},selected.id);return;}
      if(e.key==='+'||e.key==='='||e.key==='-'||e.key==='_'){e.preventDefault();
        const size=selected.labelSize??DEFAULT_LABEL_SIZE,next=Math.max(2,Math.min(72,size+(e.key==='-'||e.key==='_'?-0.5:0.5)));
        pushHistory();updateRoom({labelSize:next},selected.id);setMessage(`Label size ${fmt(next)} pt.`);return;}
    }
    if(e.key.startsWith('Arrow')&&tool==='select'&&selected){
      if(e.target instanceof HTMLInputElement)return; // e.g. the opacity slider has focus
      e.preventDefault();nudge(e.key,e.shiftKey);return;
    }
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.repeat){
      const k=e.key.length===1?e.key.toLowerCase():e.key;
      const action=ACTIONS.find(a=>settings.shortcuts[a.id]===k);
      if(action){e.preventDefault();runAction(action.id);}
    }
  };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });
  useEffect(()=>{
    const up=(e:KeyboardEvent)=>{if(e.key===' '&&spaceRef.current){spaceRef.current=false;setSpaceHeld(false);}};
    const reset=()=>{spaceRef.current=false;setSpaceHeld(false);};
    window.addEventListener('keyup',up);window.addEventListener('blur',reset);
    return()=>{window.removeEventListener('keyup',up);window.removeEventListener('blur',reset);};
  },[]);
  async function importPdf(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;
    if(rooms.length&&!window.confirm('Start a new takeoff from this PDF? This clears the current rooms.\n\nTo keep your rooms and just swap the drawing, cancel and use "Replace background" instead.')){e.target.value='';return;}
    try{const data=new Uint8Array(await file.arrayBuffer());const doc=await pdfjsLib.getDocument({data:data.slice()}).promise;
      pdfBytesRef.current=data.slice() as Uint8Array<ArrayBuffer>;projectHandleRef.current=null;setProjectName('Untitled.hvac.json');
      historyRef.current=[];setPdf(doc);setPdfName(file.name);setPageNumber(1);setRooms([]);setDraft([]);setSelectedId(null);setCalPoints([]);setScale('1/8');setCustomFeetPerPoint(null);setTool('select');setZoom(1);zoomRef.current=1;offsetRef.current={x:20,y:20};
      setMessage(`PDF loaded. Set the drawing scale, then press ${keyLabel(settings.shortcuts.draw)} to draw rooms along inside wall faces.`);
    }catch(err){console.error(err);setMessage('Unable to open PDF.');}e.target.value='';}
  // Swap the background drawing but keep every room, the scale and the project file.
  async function replacePdf(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{const data=new Uint8Array(await file.arrayBuffer());const doc=await pdfjsLib.getDocument({data:data.slice()}).promise;
      const page=pageNumber<=doc.numPages?pageNumber:1,vp=(await doc.getPage(page)).getViewport({scale:1});
      const sameSize=Math.abs(vp.width-pageSize.width)<1&&Math.abs(vp.height-pageSize.height)<1;
      pdfBytesRef.current=data.slice() as Uint8Array<ArrayBuffer>;setPdf(doc);setPdfName(file.name);setPageNumber(page);
      setMessage(`Background replaced with ${file.name}${doc.numPages>1?` (page ${page})`:''}. Rooms kept.${sameSize?'':' The new sheet is a different size.'} If the plan shifted, press Ctrl/Cmd+A, then drag or use the arrow keys to realign.${scale==='custom'?' Check the custom calibration still matches.':''}`);
    }catch(err){console.error(err);setMessage('Unable to open that PDF. The current background was kept.');}}
  function projectData():ProjectFile{return {version:1,pdfName,pdfBase64:pdfBytesRef.current?bytesToBase64(pdfBytesRef.current):null,pageNumber,scale,customFeetPerPoint,altitudeFt,rooms};}
  function downloadProject(content:string,name:string){const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  async function saveProject(saveAs=false){
    const content=JSON.stringify(projectData());
    try{
      let handle=saveAs?null:projectHandleRef.current;
      if(!handle){const picker=(window as FilePickerWindow).showSaveFilePicker;
        if(picker){handle=await picker({suggestedName:projectName,types:[{description:'HVAC Studio Project',accept:{'application/json':['.json']}}]});projectHandleRef.current=handle;setProjectName(handle.name);}
        else{downloadProject(content,projectName);setMessage('Project downloaded. This browser does not support direct overwrite; use desktop Chrome for Save to same file.');return;}
      }
      const writable=await handle.createWritable();await writable.write(content);await writable.close();
      lastSnapshotRef.current=JSON.stringify({pdfName,pageNumber,scale,customFeetPerPoint,altitudeFt,rooms});setDirty(false);
      setMessage(`Saved ${handle.name}`);
    }catch(err){if((err as Error).name!=='AbortError'){console.error(err);setMessage('Save failed. Please try Save As.');}}
  }
  async function loadProject(file:File,handle:WritableHandle|null){
    try{const parsed=JSON.parse(await file.text()) as ProjectFile;
      if(parsed.version!==1||!Array.isArray(parsed.rooms))throw new Error('Invalid project file');
      let doc:pdfjsLib.PDFDocumentProxy|null=null;let bytes:Uint8Array<ArrayBuffer>|null=null;
      if(parsed.pdfBase64){bytes=base64ToBytes(parsed.pdfBase64) as Uint8Array<ArrayBuffer>;doc=await pdfjsLib.getDocument({data:bytes.slice()}).promise;}
      historyRef.current=[];pdfBytesRef.current=bytes;setPdf(doc);setPdfName(parsed.pdfName||'No PDF');setPageNumber(parsed.pageNumber||1);
      setScale(parsed.scale||'1/8');setCustomFeetPerPoint(parsed.customFeetPerPoint??null);const fpp=(parsed.scale||'1/8')==='custom'?parsed.customFeetPerPoint??null:scaleFeetPerPoint(parsed.scale||'1/8');
      const loadedRooms=placeMissingEquipment(parsed.rooms.map(normalizeRoom),fpp?1/fpp:9);setRooms(loadedRooms);setAltitudeFt(parsed.altitudeFt??0);setSelectedId(null);setDraft([]);setTool('select');setZoom(1);zoomRef.current=1;offsetRef.current={x:20,y:20};
      projectHandleRef.current=handle;setProjectName(file.name);lastSnapshotRef.current=JSON.stringify({pdfName:parsed.pdfName||'No PDF',pageNumber:parsed.pageNumber||1,scale:parsed.scale||'1/8',customFeetPerPoint:parsed.customFeetPerPoint??null,altitudeFt:parsed.altitudeFt??0,rooms:loadedRooms});setDirty(false);
      setMessage(`Opened ${file.name}. Cmd+S saves changes to this project${handle?' directly':''}.`);
    }catch(err){console.error(err);setMessage('Could not open this HVAC Studio project.');}
  }
  async function openProject(){try{const picker=(window as FilePickerWindow).showOpenFilePicker;
    if(picker){const [handle]=await picker({types:[{description:'HVAC Studio Project',accept:{'application/json':['.json']}}]});if(handle)await loadProject(await handle.getFile(),handle as unknown as WritableHandle);}
    else document.getElementById('hvac-project-input')?.click();
  }catch(err){if((err as Error).name!=='AbortError')setMessage('Could not open project.');}}
  function pointFromEvent(e:ReactPointerEvent<SVGSVGElement>):Point {const svg=svgRef.current!;const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const matrix=svg.getScreenCTM();if(!matrix)return {x:0,y:0};
    // Return a plain object: SVGPoint's x/y are prototype getters, so {...svgPoint} would be empty.
    const q=p.matrixTransform(matrix.inverse());return {x:q.x,y:q.y};}
  function addRoom(points:Point[]){
    const id=newId(),name=`Room ${rooms.length+101}`;
    pushHistory();
    setRooms(v=>[...v,normalizeRoom({id,name,points:points.map(p=>({x:p.x,y:p.y})),labelSize:defaultLabelSize()})]);
    setSelectedId(id);draftRef.current=[];setDraft([]);setHover(null);setRectStart(null);setRectEnd(null);rectRef.current=null;
    setMessage(`${name} created. ${feetPerPoint===null?'Calibrate the scale to calculate SF.':'Area calculated from inside-face polygon.'}`);
  }
  function switchTool(t:Tool){
    setTool(t);draftRef.current=[];setDraft([]);pressRef.current=null;rectRef.current=null;setRectStart(null);setRectEnd(null);setCalPoints([]);
    if(t==='draw')setMessage('Draw: click-drag for a rectangle, or click corners for a polygon.');
    if(t==='cutout')setMessage('Cutout: click-drag for a rectangle, or click corners for a polygon. It goes into the selected room, or the room that contains it.');
    if(t==='calibrate')setMessage('Click two points of a known dimension to calibrate.');
    if(t==='select')setMessage('Select: click a room, its label, a wall, or a piece of equipment.');
    if(t==='equip')setMessage('Place equipment: pick a type, then click inside a room. Esc goes back to Select.');
  }
  function runAction(a:Action){
    if(a==='fit'){if(pdf)fitPage();return;}
    if(a==='snap'){setOrthogonal(!orthogonal);setMessage(`15° snap ${orthogonal?'off':'on'}.`);return;}
    switchTool(a);
  }
  // Cutout: goes into the selected room if it fits there, otherwise into the
  // smallest room that fully contains it. Must not overlap an existing cutout.
  function addCutout(pts:Point[]){
    if(!isSimplePolygon(pts)){setMessage('Cutout walls cross each other. Backspace to fix, or Esc to start over.');return;}
    const fits=(r:Room)=>ringInside(pts,r.points)&&!cutoutsOf(r).some(c=>ringsOverlap(c,pts));
    const target=rooms.find(r=>r.id===selectedId&&fits(r))??rooms.filter(fits).sort((a,b)=>areaPx(a.points)-areaPx(b.points))[0];
    if(!target){setMessage('A cutout must sit entirely inside one room and not overlap another cutout. Backspace to adjust, or Esc to cancel.');return;}
    pushHistory();
    const updated={...target,cutouts:[...cutoutsOf(target),pts.map(p=>({x:p.x,y:p.y}))]};
    setRooms(v=>v.map(r=>r.id===target.id?updated:r));
    setSelectedId(target.id);draftRef.current=[];setDraft([]);setHover(null);
    const cut=sf(areaPx(pts)),net=roomArea(updated);
    setMessage(cut===null?`Cutout added to ${target.name}.`:`Cutout of ${fmt(cut)} SF removed from ${target.name}. Net area now ${fmt(net!)} SF.`);
  }
  function deleteCutout(k:number){
    if(!selected)return;pushHistory();
    setRooms(v=>v.map(r=>r.id===selected.id?{...r,cutouts:cutoutsOf(r).filter((_,i)=>i!==k)}:r));
    setSelectedEdge(null);setMessage(`Cutout removed from ${selected.name}.`);
  }
  function deleteRoom(){
    const ids=selIds.length?selIds:selected?[selected.id]:[];if(!ids.length)return;pushHistory();
    setRooms(v=>v.filter(r=>!ids.includes(r.id)));setSelectedId(null);
    setMessage(`${ids.length===1?(rooms.find(r=>r.id===ids[0])?.name??'Room'):`${ids.length} rooms`} deleted. Ctrl/Cmd+Z to undo.`);
  }
  // The smallest other room this room sits inside (for "cut out of" in the properties panel).
  function containerOf(room:Room){
    return rooms.filter(r=>r.id!==room.id&&ringInside(room.points,r.points)&&!cutoutsOf(r).some(c=>ringsOverlap(c,room.points)))
      .sort((a,b)=>areaPx(a.points)-areaPx(b.points))[0];
  }
  function cutFromContainer(room:Room){
    const host=containerOf(room);if(!host)return;pushHistory();
    setRooms(v=>v.map(r=>r.id===host.id?{...r,cutouts:[...cutoutsOf(r),room.points.map(p=>({x:p.x,y:p.y}))]}:r));
    setMessage(`${room.name}'s outline is now cut out of ${host.name}.`);
  }
  function undo(){
    if(draftRef.current.length){setDraft(v=>v.slice(0,-1));return;}
    const prev=historyRef.current.pop();
    if(!prev){setMessage('Nothing to undo.');return;}
    setRooms(prev);setSelectedEdge(null);
    setSelIds(ids=>ids.filter(id=>prev.some(r=>r.id===id)));
    if(selectedId&&!prev.some(r=>r.id===selectedId))setSelectedId(null);
    setMessage('Undone.');
  }
  // ---- Equipment ----
  const ptPerFt=feetPerPoint?1/feetPerPoint:9; // uncalibrated drawings are drawn as if 1/8" = 1'-0"
  const symbolPt=(e:Equip)=>{const z=equipSize(e),r=(e.rot??0)%180!==0;return {w:(r?z.h:z.w)*ptPerFt,h:(r?z.w:z.h)*ptPerFt};};
  // Smallest room containing the point, outside its cutouts.
  function roomAt(p:Point,list=rooms){
    return list.filter(r=>pointInRing(p,r.points)&&!cutoutsOf(r).some(c=>pointInRing(p,c)))
      .sort((a,b)=>areaPx(a.points)-areaPx(b.points))[0];
  }
  function nextTag(prefix:string,list=rooms){
    const re=new RegExp(`^${prefix}-(\\d+)$`);
    const n=list.flatMap(r=>r.equipment).reduce((mx,e)=>{const m=re.exec(e.tag);return m?Math.max(mx,Number(m[1])):mx;},0);
    return `${prefix}-${n+1}`;
  }
  const roundUp5=(v:number)=>Math.max(0,Math.ceil(v/5)*5);
  const spotFor=(room:Room,e:Equip)=>freeSpot(room,[labelObstacle(room),...equipObstacles(room,ptPerFt,e.id)],equipRadiusFt(e)*ptPerFt);
  // A new unit, pre-sized to cover whatever the room's existing equipment doesn't.
  function buildEquip(room:Room,type:string,pos?:Point):Equip{
    const m=mOf(room),e=newEquip(type,nextTag(equipType(type).prefix));
    const coolLeft=(m.coolingLoad??0)-m.coolCap,heatLeft=(m.heatingLoad??0)-m.heatCap;
    if(e.method==='oa')e.coolCfm=roundUp5((m.voz??0)-m.oa);
    else if(e.method==='air'){
      if(e.cools&&coolLeft>0&&room.coolSetpoint>e.coolLat)e.coolCfm=roundUp5(coolLeft/(m.factor*(room.coolSetpoint-e.coolLat)));
      if(e.heats&&heatLeft>0&&e.heatLat>room.heatSetpoint)e.heatCfm=roundUp5(heatLeft/(m.factor*(e.heatLat-room.heatSetpoint)));
      if(e.type==='Fan Coil'&&e.cools&&e.heats){const f=Math.max(e.coolCfm,e.heatCfm);e.coolCfm=f;e.heatCfm=f;} // one fan speed
    }else{if(e.cools&&coolLeft>0)e.coolCap=Math.round(coolLeft);if(e.heats&&heatLeft>0)e.heatCap=Math.round(heatLeft);}
    e.pos=pos??spotFor(room,e);
    return e;
  }
  function selectEquip(roomId:string,id:string){
    setSelIds([roomId]);setSelectedIdRaw(roomId);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(id);
    setSettings(st=>st.rightOpen&&st.sections.hvac!==false?st:{...st,rightOpen:true,sections:{...st.sections,hvac:true}});
  }
  function addEquipTo(room:Room,type:string,pos?:Point){
    const e=buildEquip(room,type,pos);
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?{...r,equipment:[...r.equipment,e]}:r));
    selectEquip(room.id,e.id);
    setMessage(`Added ${e.tag} to ${room.name}. Drag it into place · Delete removes · Ctrl/Cmd+D duplicates.`);
  }
  function updateEquipIn(roomId:string,id:string,ch:Partial<Equip>){
    setRooms(v=>v.map(r=>r.id===roomId?{...r,equipment:r.equipment.map(e=>e.id===id?{...e,...ch}:e)}:r));
  }
  function removeEquip(roomId:string,id:string){
    const room=rooms.find(r=>r.id===roomId),e=room?.equipment.find(x=>x.id===id);if(!room||!e)return;
    pushHistory();setRooms(v=>v.map(r=>r.id===roomId?{...r,equipment:r.equipment.filter(x=>x.id!==id)}:r));
    if(selectedEquip===id)setSelectedEquip(null);if(hoverEquip===id)setHoverEquip(null);
    setMessage(`Removed ${e.tag||e.type} from ${room.name}. Ctrl/Cmd+Z to undo.`);
  }
  // Copy of a unit with a new tag: beside the original if it fits, at the given point, or anywhere free.
  function cloneInto(src:Equip,room:Room,at?:Point){
    const e:Equip={...src,id:newId(),tag:nextTag(equipType(src.type).prefix)};
    let pos=at;
    if(!pos&&src.pos){const c={x:src.pos.x+symbolPt(src).w+ptPerFt,y:src.pos.y};if(roomAt(c)?.id===room.id)pos=c;}
    e.pos=pos??spotFor(room,e);
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?{...r,equipment:[...r.equipment,e]}:r));
    selectEquip(room.id,e.id);return e;
  }
  function nudgeEquip(key:string,big:boolean){
    const eq=selected?.equipment.find(x=>x.id===selectedEquip);if(!selected||!eq?.pos)return;
    const d=({ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]} as Record<string,[number,number]>)[key];if(!d)return;
    const st=nudgeStep(big),np={x:eq.pos.x+d[0]*st,y:eq.pos.y+d[1]*st};
    if(roomAt(np)?.id!==selected.id){setMessage(`${eq.tag} would leave ${selected.name}. Drag it to move it to another room.`);return;}
    pushHistory();updateEquipIn(selected.id,eq.id,{pos:np});
  }
  function startEquipDrag(e:ReactPointerEvent<SVGElement>,room:Room,eq:Equip){
    if(tool!=='select'||e.button!==0||!eq.pos)return;
    e.stopPropagation();e.preventDefault();releaseFocus(); // no text selection / native drag that would cancel the pointer stream
    selectEquip(room.id,eq.id);
    equipDragRef.current={roomId:room.id,id:eq.id,start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),startPos:eq.pos,pushed:false};
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  // Keep the selected equipment's card in view in the properties panel.
  useEffect(()=>{if(selectedEquip)cardRefs.current.get(selectedEquip)?.scrollIntoView({block:'nearest',behavior:'smooth'});},[selectedEquip]);
  const roomIsValid=(r:Room)=>{
    const cs=cutoutsOf(r);
    return isSimplePolygon(r.points)&&cs.every(c=>isSimplePolygon(c)&&ringInside(c,r.points))
      &&cs.every((c,i)=>cs.every((d,j)=>j<=i||!ringsOverlap(c,d)));
  };
  // Arrow keys: with a wall selected, move that wall across itself; with only a room
  // selected, move the whole room (cutouts included). Shift = 1'-0", otherwise 1".
  function nudge(key:string,big:boolean){
    if(!selected)return;
    const arrows:Record<string,Point>={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}};
    const arrow=arrows[key];if(!arrow)return;
    const step=nudgeStep(big);
    let next:Room;
    if(selectedEdge){
      const ring=selectedEdge.ring<0?selected.points:cutoutsOf(selected)[selectedEdge.ring];
      if(!ring)return;
      const moved=offsetEdge(ring,selectedEdge.index,arrow,step);
      if(!moved){setMessage('That arrow runs along the selected wall. Use an arrow that points across it.');return;}
      next=selectedEdge.ring<0?{...selected,points:moved}:{...selected,cutouts:cutoutsOf(selected).map((c,k)=>k===selectedEdge.ring?moved:c)};
    }else if(selIds.length>1){
      const ids=selIds;pushHistory();
      setRooms(v=>v.map(r=>ids.includes(r.id)?translateRoom(r,arrow.x*step,arrow.y*step):r));
      setMessage(`Nudged ${ids.length} rooms ${big?'1\'-0"':'1"'}.`);return;
    }else{
      const shift=(r:Point[])=>r.map(p=>({x:p.x+arrow.x*step,y:p.y+arrow.y*step}));
      next={...selected,points:shift(selected.points),cutouts:cutoutsOf(selected).map(shift),labelPos:selected.labelPos?shift([selected.labelPos])[0]:selected.labelPos,
        equipment:selected.equipment.map(q=>q.pos?{...q,pos:shift([q.pos])[0]}:q)};
    }
    if(!roomIsValid(next)){setMessage("Can't nudge further: walls would cross or a cutout would leave its room.");return;}
    pushHistory();
    setRooms(v=>v.map(r=>r.id===next.id?next:r));
    const a=roomArea(next);
    setMessage(`Nudged ${big?'1\'-0"':'1"'}${feetPerPoint===null?' (uncalibrated: points)':''}.${a!==null?` ${next.name}: ${fmt(a)} SF net.`:''}`);
  }
  // Single entry point for closing a polygon (first-corner click, double-click, Enter).
  function finishRoom(){
    let pts = draftRef.current.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({...p}));
    // A corner placed on top of the start point isn't a real corner.
    while (pts.length > 3 && dist(pts[pts.length - 1], pts[0]) < 1) pts.pop();
    if (pts.length < 3) { setMessage('Add at least three corners before finishing.'); return; }
    if (orthogonal) { const snapped = closeSnapped(pts); if (snapped) pts = snapped; }
    if (tool === 'cutout') { addCutout(pts); return; }
    addRoom(pts);
    if (!isSimplePolygon(pts)) setMessage('Room created, but its walls cross each other. Delete it and redraw for an accurate area.');
  }
  function onPointerDown(e:ReactPointerEvent<SVGSVGElement>){if(e.button===1){e.preventDefault();return;}if(e.button!==0||!pdf)return;
    const target=e.target as Element;if(tool==='select'&&target!==svgRef.current&&target.getAttribute('data-layer')!=='background')return;
    const p=pointFromEvent(e);
    if(tool==='calibrate'){
      if(!calPoints.length){setCalPoints([p]);setMessage('Click the second point of the known dimension.');}
      else{const length=dist(calPoints[0],p);if(length<2)return;const value=window.prompt('Actual distance in feet:','10');const feet=Number(value);
        if(value!==null&&feet>0){setCustomFeetPerPoint(feet/length);setScale('custom');setTool('select');setMessage(`Custom calibration: ${fmt(length/feet)} PDF points per foot.`);}setCalPoints([]);}
    }else if(tool==='equip'){
      const room=roomAt(p);
      if(!room){setMessage('Click inside a room to place equipment.');return;}
      addEquipTo(room,placeType,p);
    }else if(tool==='draw'||tool==='cutout'){
      const corners=draftRef.current;
      if(!corners.length){
        // Don't commit yet: a drag makes a rectangle, a plain click starts a polygon.
        pressRef.current={p,x:e.clientX,y:e.clientY,dragging:false};
        lastClickRef.current={t:performance.now(),x:e.clientX,y:e.clientY};
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      // Clicking on/near the first corner closes the room (12 screen px).
      if(corners.length>=3 && dist(p,corners[0])<=12/zoomRef.current){
        finishRoom();
        return;
      }
      // Second press of a double-click: don't add a stray corner; onDoubleClick finishes.
      const prev=lastClickRef.current, now=performance.now();
      lastClickRef.current={t:now,x:e.clientX,y:e.clientY};
      if(prev&&now-prev.t<400&&Math.hypot(e.clientX-prev.x,e.clientY-prev.y)<6)return;
      const last=corners[corners.length-1];
      const next=orthogonal?snapDirection(last,p):p;
      if(dist(last,next)>1){
        draftRef.current=[...corners,next];
        setDraft(draftRef.current);
      }
    }else{
      // Select tool on empty space: box-select (Shift/Ctrl/Cmd adds to the selection).
      marqueeRef.current={start:p,add:e.shiftKey||e.ctrlKey||e.metaKey};setMarquee({a:p,b:p});
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }
  // preventDefault on a press also skips the browser's focus change, so release any focused field
  // ourselves; otherwise arrow keys / Delete would keep going to the last-edited input.
  const releaseFocus=()=>{const a=document.activeElement;if(a instanceof HTMLElement&&a!==document.body)a.blur();};
  const fmtMove=(dx:number,dy:number)=>{const f=(v:number)=>feetPerPoint?fmtFeet(Math.abs(v)*feetPerPoint):`${fmt(Math.abs(v))} pt`;
    return [dx?`${dx>0?'right':'left'} ${f(dx)}`:'',dy?`${dy>0?'down':'up'} ${f(dy)}`:''].filter(Boolean).join(', ')||'0';};
  // Press on a room: select it (Shift/Ctrl/Cmd adds or removes) and drag to move the whole selection.
  function startRoomDrag(e:ReactPointerEvent<SVGElement>,room:Room){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    let ids:string[],collapse=false;
    if(e.shiftKey||e.ctrlKey||e.metaKey){
      ids=selIds.includes(room.id)?selIds.filter(x=>x!==room.id):[...selIds,room.id];
      setSelection(ids,ids.includes(room.id)?room.id:ids[ids.length-1]??null);
      setMessage(`${ids.length} room${ids.length===1?'':'s'} selected.`);
      if(!ids.includes(room.id))return;
    }else if(selIds.includes(room.id)&&selIds.length>1){
      ids=selIds;collapse=true;setSelectedIdRaw(room.id);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);
    }else{ids=[room.id];setSelectedId(room.id);}
    moveDragRef.current={ids,start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),orig:new Map(rooms.filter(r=>ids.includes(r.id)).map(r=>[r.id,r])),pushed:false,dx:0,dy:0,clicked:room.id,collapse};
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  // Press on a wall: select it, and dragging moves it across itself (snaps to 1" when scaled).
  function startEdgeDrag(e:ReactPointerEvent<SVGElement>,room:Room,ringIdx:number,index:number){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    setSelIds([room.id]);setSelectedIdRaw(room.id);setSelectedEquip(null);setLabelSel(false);setSelectedEdge({ring:ringIdx,index});
    const ring=ringIdx<0?room.points:cutoutsOf(room)[ringIdx],normal=ring?edgeNormal(ring,index):null;
    if(!ring||!normal)return;
    edgeDragRef.current={roomId:room.id,ring:ringIdx,index,startRing:ring.map(p=>({...p})),start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),normal,pushed:false,dist:0};
    svgRef.current?.setPointerCapture(e.pointerId);
    setMessage(`${ringIdx<0?'Wall':'Cutout wall'} selected. Drag it, or use the arrow keys (1", Shift 1'-0").${ringIdx>=0?' Delete removes this cutout.':''}`);
  }
  const withRing=(room:Room,ringIdx:number,ring:Point[]):Room=>ringIdx<0?{...room,points:ring}:{...room,cutouts:cutoutsOf(room).map((c,k)=>k===ringIdx?ring:c)};
  function startLabelDrag(e:ReactPointerEvent<SVGElement>,room:Room,mode:'move'|'size'){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    if(room.id!==selectedId)setSelectedId(room.id);
    setSelectedEdge(null);setLabelSel(true);
    const pos=room.labelPos??labelPoint(room);
    labelDragRef.current={mode,id:room.id,start:pointFromEvent(e as ReactPointerEvent<SVGSVGElement>),startPos:pos,startSize:room.labelSize??DEFAULT_LABEL_SIZE,center:pos,pushed:false};
    svgRef.current?.setPointerCapture(e.pointerId);
    setMessage(mode==='move'?`${room.name} label selected. Drag to move, drag the corner handle to resize, or use + / −.`:'Drag to resize the label.');
  }
  function onPointerMove(e:ReactPointerEvent<SVGSVGElement>){
    const p=pointFromEvent(e);setHover(p);
    if(marqueeRef.current){setMarquee({a:marqueeRef.current.start,b:p});return;}
    const md=moveDragRef.current;
    if(md){
      let dx=p.x-md.start.x,dy=p.y-md.start.y;
      if(!md.pushed){if(Math.hypot(dx,dy)*zoomRef.current<3)return;pushHistory();md.pushed=true;}
      if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;} // Shift: straight horizontal or vertical
      md.dx=dx;md.dy=dy;
      setRooms(v=>v.map(r=>{const o=md.orig.get(r.id);return o?translateRoom(o,dx,dy):r;}));
      setMessage(`Moving ${md.ids.length} room${md.ids.length===1?'':'s'}: ${fmtMove(dx,dy)}. Hold Shift for straight moves.`);
      return;
    }
    const wd=edgeDragRef.current;
    if(wd){
      let d=(p.x-wd.start.x)*wd.normal.x+(p.y-wd.start.y)*wd.normal.y;
      if(!wd.pushed){if(Math.abs(d)*zoomRef.current<3)return;pushHistory();wd.pushed=true;}
      const unit=feetPerPoint?1/12/feetPerPoint:1;d=Math.round(d/unit)*unit; // whole inches (points when unscaled)
      if(d===wd.dist)return;
      const room=rooms.find(r=>r.id===wd.roomId),moved=offsetEdgeBy(wd.startRing,wd.index,d);if(!room||!moved)return;
      const next=withRing(room,wd.ring,moved);
      if(!roomIsValid(next))return; // stop at the last valid position
      wd.dist=d;setRooms(v=>v.map(r=>r.id===next.id?next:r));
      const na=mOf(next).area;
      setMessage(`Moving wall ${feetPerPoint?fmtFeet(Math.abs(d)*feetPerPoint):`${fmt(Math.abs(d))} pt`}${na!==null?` · ${next.name}: ${fmt(na)} SF`:''}`);
      return;
    }
    const ed=equipDragRef.current;
    if(ed){
      const dx=p.x-ed.start.x,dy=p.y-ed.start.y;
      if(!ed.pushed){if(Math.hypot(dx,dy)*zoomRef.current<3)return;pushHistory();ed.pushed=true;}
      const np={x:ed.startPos.x+dx,y:ed.startPos.y+dy};
      updateEquipIn(ed.roomId,ed.id,{pos:np});
      setDropTarget(roomAt(np)?.id??null);
      return;
    }
    const ld=labelDragRef.current;
    if(ld){
      const dx=p.x-ld.start.x,dy=p.y-ld.start.y;
      if(!ld.pushed){if(Math.hypot(dx,dy)*zoomRef.current<2)return;pushHistory();ld.pushed=true;}
      if(ld.mode==='move')updateRoom({labelPos:{x:ld.startPos.x+dx,y:ld.startPos.y+dy}},ld.id);
      else{const r0=Math.max(1,dist(ld.start,ld.center)),r1=dist(p,ld.center);
        updateRoom({labelSize:Math.round(Math.max(2,Math.min(72,ld.startSize*r1/r0))*2)/2},ld.id);}
      return;
    }
    const press=pressRef.current;if(!press)return;
    if(!press.dragging&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>5){press.dragging=true;rectRef.current=press.p;setRectStart(press.p);}
    if(press.dragging)setRectEnd(p);
  }
  function onPointerCancel(){
    marqueeRef.current=null;setMarquee(null);
    const md=moveDragRef.current;
    if(md){moveDragRef.current=null;if(md.pushed)setRooms(v=>v.map(r=>md.orig.get(r.id)??r));}
    const wd=edgeDragRef.current;
    if(wd){edgeDragRef.current=null;if(wd.pushed)setRooms(v=>v.map(r=>r.id===wd.roomId?withRing(r,wd.ring,wd.startRing):r));}
    const ed=equipDragRef.current;
    if(ed){equipDragRef.current=null;setDropTarget(undefined);if(ed.pushed)updateEquipIn(ed.roomId,ed.id,{pos:ed.startPos});}
    labelDragRef.current=null;pressRef.current=null;
  }
  function onPointerUp(e:ReactPointerEvent<SVGSVGElement>){
    if(labelDragRef.current){labelDragRef.current=null;return;}
    const mq=marqueeRef.current;
    if(mq){
      marqueeRef.current=null;setMarquee(null);
      const b=pointFromEvent(e);
      if(dist(mq.start,b)*zoomRef.current<4){if(!mq.add)setSelectedId(null);return;} // plain click on empty space
      const box={x0:Math.min(mq.start.x,b.x),y0:Math.min(mq.start.y,b.y),x1:Math.max(mq.start.x,b.x),y1:Math.max(mq.start.y,b.y)};
      const windowMode=b.x>=mq.start.x; // left→right: fully inside; right→left: touching
      const hits=rooms.filter(r=>windowMode?r.points.every(q=>inRect(q,box)):ringTouchesRect(r.points,box)).map(r=>r.id);
      const ids=mq.add?[...selIds,...hits.filter(id=>!selIds.includes(id))]:hits;
      setSelection(ids,ids[ids.length-1]??null);
      setMessage(ids.length?`${ids.length} room${ids.length===1?'':'s'} selected. Drag any of them, or use the arrow keys, to move them together.`:'Nothing selected.');
      return;
    }
    const md=moveDragRef.current;
    if(md){
      moveDragRef.current=null;
      if(!md.pushed){if(md.collapse)setSelectedId(md.clicked);return;} // a click inside a multi-selection picks that room
      setMessage(`Moved ${md.ids.length} room${md.ids.length===1?'':'s'} ${fmtMove(md.dx,md.dy)}. Ctrl/Cmd+Z to undo.`);
      return;
    }
    const wd=edgeDragRef.current;
    if(wd){edgeDragRef.current=null;
      if(wd.pushed){const r=rooms.find(x=>x.id===wd.roomId),a=r?mOf(r).area:null;
        setMessage(`Wall moved ${feetPerPoint?fmtFeet(Math.abs(wd.dist)*feetPerPoint):`${fmt(Math.abs(wd.dist))} pt`}.${a!==null&&r?` ${r.name}: ${fmt(a)} SF.`:''} Ctrl/Cmd+Z to undo.`);}
      return;}
    const ed=equipDragRef.current;
    if(ed){
      equipDragRef.current=null;setDropTarget(undefined);
      if(!ed.pushed)return;
      // Use the release point itself: the last move may not have rendered yet.
      const q=pointFromEvent(e),pos={x:ed.startPos.x+q.x-ed.start.x,y:ed.startPos.y+q.y-ed.start.y};
      const from=rooms.find(r=>r.id===ed.roomId),eq=from?.equipment.find(x=>x.id===ed.id);if(!from||!eq)return;
      const to=roomAt(pos);
      if(!to){updateEquipIn(ed.roomId,ed.id,{pos:ed.startPos});setMessage('Equipment has to sit inside a room, so it went back.');return;}
      if(to.id===from.id){updateEquipIn(ed.roomId,ed.id,{pos});return;}
      {
        const moved={...eq,pos};
        setRooms(v=>v.map(r=>r.id===from.id?{...r,equipment:r.equipment.filter(x=>x.id!==eq.id)}:r.id===to.id?{...r,equipment:[...r.equipment,moved]}:r));
        selectEquip(to.id,eq.id);setMessage(`Moved ${eq.tag||eq.type} from ${from.name} to ${to.name}.`);
      }
      return;
    }
    const press=pressRef.current;if(!press)return;
    pressRef.current=null;
    if(!press.dragging){draftRef.current=[press.p];setDraft(draftRef.current);return;} // first polygon corner
    const a=press.p,b=pointFromEvent(e);
    rectRef.current=null;setRectStart(null);setRectEnd(null);
    if(Math.abs(a.x-b.x)<3||Math.abs(a.y-b.y)<3)return;
    const pts=[{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.max(a.y,b.y)},{x:Math.min(a.x,b.x),y:Math.max(a.y,b.y)}];
    if(tool==='cutout')addCutout(pts);else addRoom(pts);
  }
  // The drawing is a fixed-size layer. Only its compositor transform changes.
  // No scroll-position adjustments, no layout resizing, no React render per wheel event.
  function updateViewport(){
    const world=worldRef.current;
    if(world){
      world.style.transform=`translate3d(${offsetRef.current.x}px, ${offsetRef.current.y}px, 0) scale(${zoomRef.current})`;
      // Composited layer only while moving; once idle the browser re-rasterizes labels and lines at full sharpness.
      world.classList.add('moving');
      if(movingTimerRef.current)clearTimeout(movingTimerRef.current);
      movingTimerRef.current=setTimeout(()=>{world.classList.remove('moving');movingTimerRef.current=null;},180);
    }
    scheduleDetail();
  }
  function updateZoomLabel(){
    if(zoomLabelTimerRef.current!==null)clearTimeout(zoomLabelTimerRef.current);
    zoomLabelTimerRef.current=setTimeout(()=>{setZoom(zoomRef.current);zoomLabelTimerRef.current=null;},120);
  }
  function applyZoom(next:number,clientX?:number,clientY?:number){
    const viewport=scrollRef.current;if(!viewport)return;
    const old=zoomRef.current;
    next=Math.max(.15,Math.min(8,next));
    if(Math.abs(next-old)<1e-8)return;
    const rect=viewport.getBoundingClientRect();
    const x=(clientX??rect.left+rect.width/2)-rect.left;
    const y=(clientY??rect.top+rect.height/2)-rect.top;
    const {x:ox,y:oy}=offsetRef.current;
    const factor=next/old;
    offsetRef.current={x:x-(x-ox)*factor,y:y-(y-oy)*factor};
    zoomRef.current=next;
    updateViewport();updateZoomLabel();
  }
  function zoomAt(next:number,clientX?:number,clientY?:number){applyZoom(next,clientX,clientY);}
  function onWheel(e:ReactWheelEvent<HTMLElement>){
    if(!pdf)return;
    e.preventDefault();
    // No animation or momentum is added. Each device delta maps directly to zoom.
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?400:1);
    const limited=Math.max(-120,Math.min(120,delta));
    applyZoom(zoomRef.current*Math.exp(-limited*.0012),e.clientX,e.clientY);
  }
  function onPanDown(e:ReactPointerEvent<HTMLElement>){
    const spacePan=spaceRef.current&&e.button===0;
    if((e.button!==1&&!spacePan)||!pdf)return;
    e.preventDefault();e.stopPropagation(); // the drawing never sees a pan click
    panRef.current={x:e.clientX,y:e.clientY,offsetX:offsetRef.current.x,offsetY:offsetRef.current.y};
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  }
  function onPanMove(e:ReactPointerEvent<HTMLElement>){
    if(!panRef.current)return;
    const p=panRef.current;
    offsetRef.current={x:p.offsetX+e.clientX-p.x,y:p.offsetY+e.clientY-p.y};
    updateViewport();
  }
  function endPan(){if(!panRef.current)return;panRef.current=null;setPanning(false);}
  function fitPage(){
    const viewport=scrollRef.current;if(!viewport)return;
    const z=Math.max(.15,Math.min(4,Math.min((viewport.clientWidth-48)/pageSize.width,(viewport.clientHeight-48)/pageSize.height)));
    zoomRef.current=z;
    offsetRef.current={x:(viewport.clientWidth-pageSize.width*z)/2,y:(viewport.clientHeight-pageSize.height*z)/2};
    updateViewport();updateZoomLabel();
  }
  function updateRoom(changes:Partial<Room>,id=selectedId){setRooms(v=>v.map(r=>r.id===id?{...r,...changes}:r));}
  function exportCsv(){
    const raw=(v:number|string|null,dec=1)=>v===null?'':typeof v==='number'?Number(v.toFixed(dec)):v;
    const rows:(string|number)[][]=[[...COLUMNS.map(c=>c.label),'Load Breakdown'],
      ...rooms.map(r=>{const m=mOf(r);return [...COLUMNS.map(c=>raw(c.get(r,m,{tpl:templateName}),c.dec??1)),r.loads.map(l=>`${l.name}: ${tidy(l.value)} ${l.unit}`).join('; ')];})];
    const csv=rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='hvac-room-takeoff.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const edgeRing=selected&&selectedEdge?(selectedEdge.ring<0?selected.points:cutoutsOf(selected)[selectedEdge.ring]):null;
  const edgeA=edgeRing?edgeRing[selectedEdge!.index]:null,edgeB=edgeRing?edgeRing[(selectedEdge!.index+1)%edgeRing.length]:null;
  const edgeLen=edgeA&&edgeB?dist(edgeA,edgeB):null;
  const host=selected?containerOf(selected):undefined;
  const drawColor=tool==='cutout'?'#dc2626':'#2563eb';
  const previewPoint=draft.length&&hover?(orthogonal?snapDirection(draft[draft.length-1],hover):hover):null;
  const rectPreview=rectStart&&rectEnd?[{x:rectStart.x,y:rectStart.y},{x:rectEnd.x,y:rectStart.y},{x:rectEnd.x,y:rectEnd.y},{x:rectStart.x,y:rectEnd.y}]:null;
  return <div className="hvac-app">
    <header className="hvac-header"><div><strong>HVAC Studio</strong><small>Room takeoff & engineering workspace</small></div><small>{projectName}{dirty?" • Unsaved changes":""} · {pdfName}</small></header>
    <div className="hvac-toolbar">
      <input id="hvac-project-input" type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void loadProject(f,null);e.target.value='';}}/>
      <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={importPdf} hidden/>
      <div className="hvac-group"><span className="hvac-group-label">Project</span><div className="hvac-group-items">
        <IconBtn tip="Open project" onClick={()=>void openProject()}><FolderOpen size={17}/></IconBtn>
        <IconBtn tip="Save (Ctrl/Cmd+S)" onClick={()=>void saveProject()}><Save size={17}/></IconBtn>
        <IconBtn tip="Save as…" onClick={()=>void saveProject(true)}><SaveAll size={17}/></IconBtn>
      </div></div>
      <div className="hvac-group"><span className="hvac-group-label">PDF</span><div className="hvac-group-items">
        <IconBtn tip="Import PDF (new takeoff)" onClick={()=>fileRef.current?.click()}><Upload size={17}/></IconBtn>
        <input ref={replaceRef} type="file" accept=".pdf,application/pdf" onChange={replacePdf} hidden/>
        <IconBtn tip="Replace background PDF (keeps rooms)" disabled={!pdf} onClick={()=>replaceRef.current?.click()}><RefreshCw size={17}/></IconBtn>
        <select className="hvac-scale-select" title="Drawing scale" aria-label="Drawing scale" value={scale} onChange={e=>{const v=e.target.value;setScale(v);e.currentTarget.blur();if(v==='custom')switchTool('calibrate');}}>{scales.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        <IconBtn tip={`Calibrate scale (${sc('calibrate')})`} active={tool==='calibrate'} onClick={()=>switchTool('calibrate')}><Ruler size={17}/></IconBtn>
        <label className="hvac-opacity" data-tip="PDF opacity"><Eye size={16}/><input type="range" min={10} max={100} step={5} value={Math.round(settings.pdfOpacity*100)} aria-label="PDF opacity" onChange={e=>setSettings(st=>({...st,pdfOpacity:Number(e.target.value)/100}))} onPointerUp={e=>e.currentTarget.blur()}/><span>{Math.round(settings.pdfOpacity*100)}%</span></label>
        <IconBtn tip="Zoom out" onClick={()=>zoomAt(Math.max(.15,zoom/1.25))}><ZoomOut size={17}/></IconBtn>
        <span className="hvac-zoom">{Math.round(zoom*100)}%</span>
        <IconBtn tip="Zoom in" onClick={()=>zoomAt(Math.min(8,zoom*1.25))}><ZoomIn size={17}/></IconBtn>
        <IconBtn tip={`Fit page (${sc('fit')})`} disabled={!pdf} onClick={fitPage}><Maximize size={17}/></IconBtn>
      </div></div>
      <div className="hvac-group"><span className="hvac-group-label">Draw</span><div className="hvac-group-items">
        <IconBtn tip={`Select (${sc('select')})`} active={tool==='select'} onClick={()=>switchTool('select')}><MousePointer2 size={17}/></IconBtn>
        <IconBtn tip={`Draw room — drag for rectangle, click corners for polygon (${sc('draw')})`} active={tool==='draw'} onClick={()=>switchTool('draw')}><PenTool size={17}/></IconBtn>
        <IconBtn tip={`Cutout — drag for rectangle, click corners for polygon (${sc('cutout')})`} active={tool==='cutout'} onClick={()=>switchTool('cutout')}><Scissors size={17}/></IconBtn>
        <IconBtn tip={`Place equipment — click inside a room (${sc('equip')})`} active={tool==='equip'} onClick={()=>switchTool('equip')}><AirVent size={17}/></IconBtn>
        {tool==='equip'&&<select className="hvac-scale-select" title="Equipment type to place" aria-label="Equipment type to place" value={placeType} onChange={e=>{setPlaceType(e.target.value);e.currentTarget.blur();}}>
          {EQUIP_TYPES.map(t=><option key={t.type}>{t.type}</option>)}</select>}
        <IconBtn tip={`15° snap: ${orthogonal?'on':'off'} (${sc('snap')})`} active={orthogonal} onClick={()=>runAction('snap')}><Magnet size={17}/></IconBtn>
        <IconBtn tip="Undo (Ctrl/Cmd+Z)" onClick={undo}><Undo2 size={17}/></IconBtn>
      </div></div>
      <div className="hvac-group"><span className="hvac-group-label">Output</span><div className="hvac-group-items">
        <IconBtn tip="Reports" active={reportsOpen} onClick={()=>setReportsOpen(true)}><ClipboardList size={17}/></IconBtn>
        <IconBtn tip="Export all room data to CSV" disabled={!rooms.length} onClick={exportCsv}><Download size={17}/></IconBtn>
      </div></div>
      <div className="hvac-spacer"/>
      <div className="hvac-group hvac-group-end"><span className="hvac-group-label">App</span><div className="hvac-group-items">
        <IconBtn tip="Settings" active={settingsOpen} onClick={()=>{setSettingsOpen(true);setCaptureNote('');}}><Settings size={17}/></IconBtn>
      </div></div>
    </div>
    <div className="hvac-content">
      <SidePanel side="left" title="Rooms" open={settings.leftOpen} onToggle={()=>setSettings(st=>({...st,leftOpen:!st.leftOpen}))}>
        <div className="hvac-roomlist">
          {rooms.length===0?<p className="hvac-muted">No rooms drawn yet. Press {sc('draw')} to draw one.</p>:rooms.map(r=>{const a=roomArea(r);return <button key={r.id} className={`hvac-room ${selIds.includes(r.id)?'active':''}`} title="Shift- or Ctrl-click to add to the selection" onClick={ev=>{setTool('select');
            if(ev.shiftKey||ev.ctrlKey||ev.metaKey){const ids=selIds.includes(r.id)?selIds.filter(x=>x!==r.id):[...selIds,r.id];setSelection(ids,ids.includes(r.id)?r.id:ids[ids.length-1]??null);}else setSelectedId(r.id);}}><strong>{roomHasIssue(mOf(r))&&<span className="hvac-issue-dot" title="Outdoor air, cooling or heating doesn't meet the requirement"/>}{r.name}</strong><span>{a===null?'Unscaled':`${fmt(a)} SF`}</span></button>;})}
        </div>
        {rooms.length>0&&feetPerPoint!==null&&(()=>{const tot=rooms.reduce((t,r)=>t+(roomArea(r)??0),0);
          const ms=rooms.map(mOf),oa=ms.reduce((t,m)=>t+(m.voz??0),0),prov=ms.reduce((t,m)=>t+m.oa,0);
          return <div className="hvac-totals"><div className="hvac-row"><span>Total net area</span><strong>{fmt(tot)} SF</strong></div><div className="hvac-row"><span>Required OA (ΣV<sub>oz</sub>)</span><strong>{fmt(oa)} cfm</strong></div><div className="hvac-row"><span>Provided OA</span><strong className={prov<oa-0.05?'hvac-bad-text':undefined}>{fmt(prov)} cfm</strong></div></div>;})()}
      </SidePanel>
      <main ref={scrollRef} className={`hvac-main${spaceHeld?' pan-ready':''}${panning?' panning':''}`} onWheel={onWheel} onPointerDownCapture={onPanDown} onPointerMoveCapture={onPanMove} onPointerUpCapture={endPan} onPointerCancelCapture={endPan} onAuxClick={e=>e.preventDefault()}>
        {!pdf?<div className="hvac-empty"><FileText size={54} strokeWidth={1.3}/><strong>Start with a floor plan</strong><span>Import a PDF, choose its scale, then trace inside wall faces.</span><button className="hvac-btn primary" onClick={()=>fileRef.current?.click()}>Choose PDF</button></div>:
          <div ref={sheetRef} className="hvac-sheet" style={{width:0,height:0,boxShadow:"none",background:"transparent"}}>
            <div ref={worldRef} className="hvac-world" style={{width:pageSize.width,height:pageSize.height,transform:`translate3d(${offsetRef.current.x}px, ${offsetRef.current.y}px, 0) scale(${zoomRef.current})`,transformOrigin:"0 0",background:"white",boxShadow:"0 6px 26px #64748b35"}}>
              <canvas ref={canvasRef} style={{opacity:settings.pdfOpacity}}/>
              <canvas ref={detailRef} className="hvac-detail" style={{opacity:settings.pdfOpacity}}/>
              <svg ref={svgRef} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`} width={pageSize.width} height={pageSize.height} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onDoubleClick={e=>{if((tool==='draw'||tool==='cutout')&&draftRef.current.length>=3){e.preventDefault();finishRoom();}}} onContextMenu={e=>e.preventDefault()} style={{cursor:tool==='select'?'default':tool==='equip'?'copy':'crosshair'}}>
                <rect data-layer="background" width={pageSize.width} height={pageSize.height} fill="transparent"/>
                {rooms.map(room=><g key={room.id} onPointerDown={e=>startRoomDrag(e,room)} style={{pointerEvents:tool==='select'?'auto':'none'}}>
                  <path d={[room.points,...cutoutsOf(room)].map(ringPath).join('')} fillRule="evenodd" fill={selIds.includes(room.id)?'#3b82f6':'#22c55e'} fillOpacity={room.id === selectedId ? 0.24 : 0.14} stroke={selIds.includes(room.id)?'#2563eb':'#16a34a'} strokeWidth={2/zoom}/>
                  {cutoutsOf(room).map((c,k)=><path key={k} d={ringPath(c)} fill="none" stroke="#dc2626" strokeWidth={1.5/zoom} strokeDasharray={`${5/zoom} ${3/zoom}`} pointerEvents="none"/>)}
                </g>)}
                {tool==='select'&&edgeA&&edgeB&&<g pointerEvents="none">
                  <line x1={edgeA.x} y1={edgeA.y} x2={edgeB.x} y2={edgeB.y} stroke="#f97316" strokeWidth={5/zoom} strokeLinecap="round"/>
                  <circle cx={edgeA.x} cy={edgeA.y} r={4/zoom} fill="#f97316"/><circle cx={edgeB.x} cy={edgeB.y} r={4/zoom} fill="#f97316"/>
                </g>}
                {tool==='select'&&rooms.map(room=>[room.points,...cutoutsOf(room)].map((ring,ri)=>ring.map((a,i)=>{const b=ring[(i+1)%ring.length];
                  const ang=Math.abs(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI)%180,cur=ang<30||ang>150?'ns-resize':ang>60&&ang<120?'ew-resize':ang<90?'nesw-resize':'nwse-resize';
                  return <line key={`${room.id}-${ri}-${i}`} className="hvac-edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10/zoom} strokeLinecap="butt" pointerEvents="stroke"
                    style={{cursor:cur}} onPointerDown={e=>startEdgeDrag(e,room,ri-1,i)}/>;})))}
                {rooms.map(room=>{const lp=room.labelPos??labelPoint(room),size=room.labelSize??DEFAULT_LABEL_SIZE,a=roomArea(room),sel=room.id===selectedId;
                  return <text key={room.id} ref={el=>{if(el)labelRefs.current.set(room.id,el);else labelRefs.current.delete(room.id);}}
                    className={tool==='select'?'hvac-label':undefined} x={lp.x} y={lp.y} textAnchor="middle"
                    fill={sel?'#1d4ed8':'#1e3a8a'} stroke="white" strokeWidth={size*0.28} paintOrder="stroke" strokeLinejoin="round" fontSize={size} fontWeight="bold"
                    pointerEvents={tool==='select'?'visiblePainted':'none'} onPointerDown={e=>startLabelDrag(e,room,'move')}>
                    <tspan x={lp.x} dy={a!==null?-size*0.15:size*0.35}>{room.name}</tspan>
                    {a!==null&&<tspan x={lp.x} dy={size*1.05} fontSize={size*0.85} fontWeight={600}>{fmt(a)} SF</tspan>}
                  </text>;})}
                {tool==='select'&&labelSel&&selected&&labelBox&&(()=>{const pad=(selected.labelSize??DEFAULT_LABEL_SIZE)*0.25,h=7/zoom;
                  const bx=labelBox.x-pad,by=labelBox.y-pad,bw=labelBox.width+pad*2,bh=labelBox.height+pad*2;
                  return <g>
                    <rect x={bx} y={by} width={bw} height={bh} fill="none" stroke="#f97316" strokeWidth={1.2/zoom} strokeDasharray={`${4/zoom} ${3/zoom}`} pointerEvents="none"/>
                    <rect className="hvac-label-handle" x={bx+bw-h/2} y={by+bh-h/2} width={h} height={h} fill="white" stroke="#f97316" strokeWidth={1.5/zoom} onPointerDown={e=>startLabelDrag(e,selected,'size')}/>
                  </g>;})()}
                {dropTarget&&(()=>{const r=rooms.find(x=>x.id===dropTarget);return r&&r.id!==selectedId?<path d={ringPath(r.points)} fill="#16a34a" fillOpacity={.08} stroke="#16a34a" strokeWidth={3/zoom} strokeDasharray={`${8/zoom} ${5/zoom}`} pointerEvents="none"/>:null;})()}
                {rooms.map(room=>room.equipment.map(eq=>{if(!eq.pos)return null;
                  const t=equipType(eq.type),{w,h}=symbolPt(eq),sel=eq.id===selectedEquip,hov=eq.id===hoverEquip,oa=eq.method==='oa';
                  const st=styleOf(eq.type),lost=sel&&dropTarget===null,color=lost?'#dc2626':st.color,stroke=sel?'#f97316':hov?'#f59e0b':color;
                  const fs=Math.max(2.5,Math.min(w,h)*(oa?0.42:0.34)),flow=equipSupply(eq),cap=eq.method==='capacity'?(eq.cools?eq.coolCap:eq.heatCap):null;
                  const sub=cap!==null?`${fmt(Math.round(cap/100)/10)} MBH`:`${fmt(flow)} cfm`;
                  return <g key={eq.id} className={tool==='select'?'hvac-equip-sym':undefined} pointerEvents={tool==='select'?'all':'none'}
                    onPointerDown={e=>startEquipDrag(e,room,eq)} onPointerEnter={()=>setHoverEquip(eq.id)} onPointerLeave={()=>setHoverEquip(null)}>
                    <rect x={eq.pos.x-w/2} y={eq.pos.y-h/2} width={w} height={h} rx={oa?0:Math.min(w,h)*0.08} fill={color} fillOpacity={Math.min(1,st.opacity+(sel?.12:0))} stroke={stroke} strokeWidth={(sel||hov?2.2:1.3)/zoom}/>
                    {oa&&<path d={`M${eq.pos.x-w/2},${eq.pos.y-h/2}L${eq.pos.x+w/2},${eq.pos.y+h/2}M${eq.pos.x+w/2},${eq.pos.y-h/2}L${eq.pos.x-w/2},${eq.pos.y+h/2}`} stroke={color} strokeWidth={1/zoom} pointerEvents="none"/>}
                    <text x={eq.pos.x} y={oa?eq.pos.y+h/2+fs*1.05:eq.pos.y-fs*0.15} textAnchor="middle" fontSize={fs} fontWeight={700} fill={lost?'#b91c1c':'#0f172a'} stroke="white" strokeWidth={fs*0.25} paintOrder="stroke" pointerEvents="none">
                      {eq.tag||t.prefix}{oa?` · ${sub}`:''}</text>
                    {!oa&&<text x={eq.pos.x} y={eq.pos.y+fs*0.95} textAnchor="middle" fontSize={fs*0.8} fill="#334155" stroke="white" strokeWidth={fs*0.2} paintOrder="stroke" pointerEvents="none">{sub}</text>}
                  </g>;}))}
                {tool==='equip'&&hover&&(()=>{const g=newEquip(placeType),{w,h}=symbolPt(g),ok=!!roomAt(hover),c=ok?styleOf(placeType).color:'#dc2626';
                  return <g pointerEvents="none" opacity={.6}><rect x={hover.x-w/2} y={hover.y-h/2} width={w} height={h} fill={c} fillOpacity={.15} stroke={c} strokeWidth={1.5/zoom} strokeDasharray={`${4/zoom} ${3/zoom}`}/>
                    {g.method==='oa'&&<path d={`M${hover.x-w/2},${hover.y-h/2}L${hover.x+w/2},${hover.y+h/2}M${hover.x+w/2},${hover.y-h/2}L${hover.x-w/2},${hover.y+h/2}`} stroke={c} strokeWidth={1/zoom}/>}</g>;})()}
                {marquee&&(()=>{const win=marquee.b.x>=marquee.a.x,c=win?'#2563eb':'#16a34a';
                  return <rect x={Math.min(marquee.a.x,marquee.b.x)} y={Math.min(marquee.a.y,marquee.b.y)} width={Math.abs(marquee.b.x-marquee.a.x)} height={Math.abs(marquee.b.y-marquee.a.y)}
                    fill={c} fillOpacity={.08} stroke={c} strokeWidth={1/zoom} strokeDasharray={win?undefined:`${5/zoom} ${3/zoom}`} pointerEvents="none"/>;})()}
                {rectPreview&&<polygon points={rectPreview.map(p=>`${p.x},${p.y}`).join(' ')} fill={drawColor} fillOpacity={.12} stroke={drawColor} strokeWidth={2/zoom} strokeDasharray={`${5/zoom} ${4/zoom}`} pointerEvents="none"/>}
                {draft.length>0&&<><polyline points={[...draft,...(previewPoint?[previewPoint]:[])].map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={drawColor} strokeWidth={2/zoom} strokeDasharray={`${6/zoom} ${4/zoom}`} pointerEvents="none"/>{draft.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={(i===0?10:3)/zoom} fill={i===0?'#f59e0b':drawColor} pointerEvents="none"/>)}</>}
                {calPoints.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={5/zoom} fill="#ef4444" pointerEvents="none"/>)}
              </svg>
            </div>
          </div>}
      </main>
      <SidePanel side="right" title="Properties" open={settings.rightOpen} onToggle={()=>setSettings(st=>({...st,rightOpen:!st.rightOpen}))}>
        <Section title="Drawing" open={secOpen('drawing')} onToggle={()=>toggleSec('drawing')} aside={scale==='custom'?(feetPerPoint?'calibrated':'not calibrated'):scales.find(x=>x[0]===scale)?.[1]}>
          <div className="hvac-row"><span>Scale</span><strong>{scale==='custom'?(feetPerPoint?`${fmt(1/feetPerPoint)} pts / ft`:'Not calibrated'):scales.find(x=>x[0]===scale)?.[1]}</strong></div>
          {pdf&&pdf.numPages>1&&<div className="hvac-row"><span>PDF page</span><select value={pageNumber} onChange={e=>{const next=Number(e.target.value);e.currentTarget.blur();if(next===pageNumber)return;if(rooms.length&&!window.confirm('Switching PDF pages currently clears room takeoffs. Save your project first. Continue?'))return;setPageNumber(next);setRooms([]);setDraft([]);setSelectedId(null);}}>{Array.from({length:pdf.numPages},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></div>}
          <div className="hvac-field"><label>Site altitude (ft)</label><NumField value={altitudeFt} onChange={setAltitudeFt}/>
            <div className="hvac-muted hvac-load-eq">Sensible heat factor {sensibleFactor(altitudeFt).toFixed(3)} BTU/h·cfm·°F (1.08 at sea level)</div></div>
          {selected&&selIds.length<=1&&<>
            <div className="hvac-subhead">{selected.name}</div>
            <div className="hvac-field"><label>Label size (pt)</label><div className="hvac-inline"><NumField value={selected.labelSize??DEFAULT_LABEL_SIZE} min={2} onChange={v=>updateRoom({labelSize:Math.min(72,v)})}/>
              <button className="hvac-btn" title="Put the label back in its automatic position" disabled={!selected.labelPos} onClick={()=>{pushHistory();updateRoom({labelPos:null});}}>Reset position</button></div></div>
            <div className="hvac-field"><label>Cutouts</label>
              {cutoutsOf(selected).length===0?<div className="hvac-muted">None. Use the Cutout tool ({sc('cutout')}) to remove an area from this room.</div>:
                cutoutsOf(selected).map((c,k)=><div className="hvac-cutout-row" key={k}><span className="hvac-cutout-swatch"/>Cutout {k+1}
                  <strong>{sf(areaPx(c))===null?'—':`−${fmt(sf(areaPx(c))!)} SF`}</strong>
                  <button className="hvac-btn icon-only" title={`Remove cutout ${k+1}`} onClick={()=>deleteCutout(k)}><Trash2 size={13}/></button></div>)}</div>
            {host&&<button className="hvac-btn" style={{width:'100%'}} onClick={()=>cutFromContainer(selected)}><Scissors size={15}/> Cut this room out of {host.name}</button>}
          </>}
          <p className="hvac-muted" style={{marginTop:12}}>Verify the printed scale against a known dimension before relying on areas. Controls and shortcuts are listed in{' '}
            <button className="hvac-linkbtn" style={{padding:0}} onClick={()=>{setSettingsOpen(true);setCaptureNote('');}}>Settings</button>.</p>
        </Section>
        {!selected&&<p className="hvac-muted hvac-pad">Select a room to see its properties. Shift-click or drag a box to select several.</p>}
        {selIds.length>1&&(()=>{const list=rooms.filter(r=>selIds.includes(r.id)),ms=list.map(mOf),tot=ms.reduce((t,m)=>t+(m.area??0),0),eq=list.reduce((t,r)=>t+r.equipment.length,0);
          return <section className="hvac-sec open"><div className="hvac-sec-head" style={{cursor:'default'}}><span>Selection</span><span className="hvac-sec-aside">{list.length} rooms</span></div>
            <div className="hvac-sec-body">
              <div className="hvac-area-card">
                <div><strong>{list.length}</strong><span>Rooms</span></div>
                <div><strong>{feetPerPoint===null?'—':fmt(tot)}</strong><span>Net SF</span></div>
                <div><strong>{eq}</strong><span>Equipment</span></div>
              </div>
              <div className="hvac-sel-list">{list.map(r=><button key={r.id} className="hvac-sel-chip" title="Remove from selection" onClick={()=>{const ids=selIds.filter(x=>x!==r.id);setSelection(ids,ids[ids.length-1]??null);}}>{r.name} <X size={11}/></button>)}</div>
              <p className="hvac-muted">Drag any selected room to move them all, or use the arrow keys (1", Shift 1'-0"). Hold Shift while dragging for a straight move. Esc clears the selection.</p>
              <button className="hvac-btn danger" style={{width:'100%'}} onClick={deleteRoom}><Trash2 size={15}/> Delete {list.length} rooms</button>
            </div></section>;})()}
        {selected&&selectedEdge&&edgeLen!==null&&tool==='select'&&<Section title={selectedEdge.ring<0?'Selected Wall':`Cutout ${selectedEdge.ring+1} Wall`} open={secOpen('wall')} onToggle={()=>toggleSec('wall')}>
          <div className="hvac-row"><span>Length</span><strong>{feetPerPoint===null?`${fmt(edgeLen)} pts`:fmtFeet(edgeLen*feetPerPoint)}</strong></div>
          <p className="hvac-muted">Arrow keys move this wall 1" (Shift: 1'-0"). Neighbouring walls stretch to follow and keep their angles. Esc deselects.</p>
        </Section>}
        {selected&&selIds.length<=1&&(()=>{const m=mOf(selected),net=m.area,occ=m.occupants,vbz=m.vbz,loadW=m.loadW,totalW=m.totalW;
          const tpl=findTemplate(selected.template);
          const tag=(match:boolean)=><div className={`hvac-tpl-tag${tpl&&match?'':' custom'}`}>Template: <strong>{tpl&&match?tpl.name:'Custom'}</strong></div>;
          const cfm=(v:number|null)=>v===null?'—':`${fmt(v)} cfm`;
          const btu=(v:number|null)=>v===null?'—':`${fmt(Math.round(v))} BTU/h`;
          return <>
          <Section title="Room Properties" open={secOpen('room')} onToggle={()=>toggleSec('room')} aside={net===null?undefined:`${fmt(net)} SF`}>
            <div className="hvac-field"><label>Template</label><div className="hvac-inline">
              <select className="hvac-grow" value={tplChoice} onChange={e=>setTplChoice(e.target.value)} aria-label="Room template">
                <option value="">Choose a template…</option>
                <optgroup label="Standard">{BUILTIN_TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                {settings.roomTemplates.length>0&&<optgroup label="My templates">{settings.roomTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              </select>
              <button className="hvac-btn primary" disabled={!tplChoice} title="Apply the template's ventilation, airflow and load values" onClick={()=>applyTemplateTo(selected,tplChoice)}><Check size={14}/> Apply</button>
              {findTemplate(tplChoice)&&!findTemplate(tplChoice)!.builtin&&<button className="hvac-btn icon-only" title="Delete this saved template" onClick={()=>deleteRoomTemplate(tplChoice)}><Trash2 size={13}/></button>}
            </div>
            <button className="hvac-linkbtn" onClick={()=>saveRoomAsTemplate(selected)}>Save this room's settings as a template…</button></div>
            <div className="hvac-field"><label>Name</label><input value={selected.name} onChange={e=>updateRoom({name:e.target.value})}/></div>
            <div className="hvac-field"><label>Ceiling height (ft)</label><NumField value={selected.height} onChange={v=>updateRoom({height:v})}/></div>
            <div className="hvac-area-card">
              <div><strong>{net===null?'—':fmt(net)}</strong><span>Net SF</span></div>
              <div><strong>{m.volume===null?'—':fmt(Math.round(m.volume))}</strong><span>Volume CF</span></div>
              <div><strong>{m.perimeter===null?'—':fmt(m.perimeter)}</strong><span>Perim. LF</span></div>
            </div>
            {net===null?<div className="hvac-area-note">Set or calibrate the drawing scale to calculate areas.</div>
              :cutoutsOf(selected).length>0&&<div className="hvac-area-note">{fmt(m.gross!)} SF gross − {fmt(m.cutouts!)} SF in {cutoutsOf(selected).length} cutout{cutoutsOf(selected).length>1?'s':''}</div>}
            <button className="hvac-btn danger" style={{width:'100%'}} onClick={deleteRoom}><Trash2 size={15}/> Delete Room</button>
          </Section>
          <Section title="ASHRAE 62.1 Ventilation" open={secOpen('ashrae')} onToggle={()=>toggleSec('ashrae')} aside={<span className={m.oaShort?'hvac-bad-text':undefined}>{cfm(m.voz)}</span>}>
            {tag(!!tpl&&ashraeMatches(selected,tpl))}
            <div className="hvac-field"><label>Occupancy</label><div className="hvac-inline">
              <NumField value={selected.occupancy.value} onChange={v=>updateRoom({occupancy:{...selected.occupancy,value:v}})}/>
              <select value={selected.occupancy.unit} onChange={e=>updateRoom({occupancy:{...selected.occupancy,unit:e.target.value as OccUnit}})}>
                {OCC_UNITS.map(([u,l])=><option key={u} value={u}>{l}</option>)}</select></div></div>
            {selected.occupancy.unit!=='people'&&<div className="hvac-row"><span>Occupants (P<sub>z</sub>)</span><strong>{occ===null?'Calibrate first':fmt(occ)}</strong></div>}
            <div className="hvac-field"><label>People outdoor air rate, R<sub>p</sub> (cfm/person)</label><NumField value={selected.rp} onChange={v=>updateRoom({rp:v})}/></div>
            <div className="hvac-field"><label>Area outdoor air rate, R<sub>a</sub> (cfm/SF)</label><NumField value={selected.ra} onChange={v=>updateRoom({ra:v})}/></div>
            <div className="hvac-field"><label>Zone air distribution effectiveness, E<sub>z</sub></label><NumField value={selected.ez} min={0.01} onChange={v=>updateRoom({ez:v})}/></div>
            <div className="hvac-row"><span>V<sub>bz</sub> = R<sub>p</sub>·P<sub>z</sub> + R<sub>a</sub>·A<sub>z</sub></span><strong>{cfm(vbz)}</strong></div>
            <div className="hvac-row hvac-result"><span>Required OA, V<sub>oz</sub> = V<sub>bz</sub> / E<sub>z</sub></span><strong>{cfm(m.voz)}</strong></div>
            <div className="hvac-row hvac-result"><span>Provided OA (from equipment)</span><strong className={m.oaShort?'hvac-bad-text':undefined}>{cfm(m.oa)}</strong></div>
            {m.oaShort&&<div className="hvac-bad-note">{fmt(m.voz!-m.oa)} cfm below the required {cfm(m.voz)}.{' '}
              <button className="hvac-linkbtn" onClick={()=>addEquipTo(selected,OA_DIFFUSER)}>Add an OA diffuser for {fmt(roundUp5(m.voz!-m.oa))} cfm</button></div>}
            {!selected.equipment.length&&<p className="hvac-muted">Outdoor air comes from the room's equipment: each unit's airflow × its % OA, plus OA diffusers.</p>}
          </Section>
          <Section title="Loads" open={secOpen('loads')} onToggle={()=>toggleSec('loads')} aside={totalW===null?undefined:`${fmt(totalW*BTUH_PER_W)} BTU/h`}>
            {tag(!!tpl&&loadsMatch(selected,tpl))}
            {selected.loads.map((l,k)=><div className="hvac-load" key={l.id}>
              <input className="hvac-load-name" value={l.name} aria-label="Load name" onChange={e=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,name:e.target.value}:x)})}/>
              <div className="hvac-inline">
                <NumField value={l.value} onChange={v=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,value:v}:x)})}/>
                <select value={l.unit} onChange={e=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,unit:e.target.value as LoadUnit}:x)})}>{LOAD_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select>
                <button className="hvac-btn icon-only" title="Remove load" onClick={()=>updateRoom({loads:selected.loads.filter((_,j)=>j!==k)})}><Trash2 size={13}/></button>
              </div>
              {loadW[k]!==null&&l.unit!=='W'&&<div className="hvac-muted hvac-load-eq">= {fmt(loadW[k]!)} W</div>}
            </div>)}
            <button className="hvac-btn" style={{width:'100%',marginTop:4}} onClick={()=>updateRoom({loads:[...selected.loads,{id:newId(),name:'Load',value:0,unit:'W'}]})}><Plus size={14}/> Add load</button>
            <div className="hvac-row"><span>Internal loads</span><strong>{totalW===null?'Calibrate first':`${fmt(totalW)} W · ${btu(totalW*BTUH_PER_W)}`}</strong></div>
            <div className="hvac-row"><span>Load density</span><strong>{totalW===null||!net?'—':`${fmt(totalW/net)} W/SF`}</strong></div>
            <div className="hvac-field"><label>People sensible heat (BTU/h per person)</label><NumField value={selected.peopleSensible} onChange={v=>updateRoom({peopleSensible:v})}/>
              <div className="hvac-muted hvac-load-eq">{occ===null?'—':`${fmt(occ)} people → ${btu(m.peopleBtuh)}`}</div></div>
            <div className="hvac-row hvac-result"><span>Sensible cooling load</span><strong>{btu(m.coolingLoad)}</strong></div>
          </Section>
          <Section title="Mechanical Equipment" open={secOpen('hvac')} onToggle={()=>toggleSec('hvac')}
            aside={selected.equipment.length?<span className={m.coolingShort||m.heatingShort||m.oaShort?'hvac-bad-text':'hvac-ok-text'}>{selected.equipment.length} unit{selected.equipment.length>1?'s':''} · {m.coolingShort||m.heatingShort?'short':'OK'}</span>:undefined}>
            <div className="hvac-mech-summary">
              <Meter label="Cooling" have={m.coolCap} need={m.coolingLoad} short={m.coolingShort}/>
              <Meter label="Heating" have={m.heatCap} need={m.heatingLoad} short={m.heatingShort}/>
              <div className="hvac-row"><span>Supply air</span><strong>{cfm(m.supply)}{m.achSupply?` · ${fmt(m.achSupply)} ACH`:''}</strong></div>
              <div className="hvac-row"><span>Outdoor air</span><strong className={m.oaShort?'hvac-bad-text':undefined}>{fmt(m.oa)}{m.voz?` / ${fmt(m.voz)}`:''} cfm</strong></div>
              {m.coolingShort&&m.coolingLoad!==null&&<div className="hvac-bad-note">Cooling is short {btu(m.coolingLoad-m.coolCap)}: about {fmt(roundUp5((m.coolingLoad-m.coolCap)/(m.factor*Math.max(1,selected.coolSetpoint-m.designLat))))} more cfm at {fmt(m.designLat)} °F.</div>}
              {m.heatingShort&&m.heatingLoad!==null&&<div className="hvac-bad-note">Heating is short {btu(m.heatingLoad-m.heatCap)}.</div>}
            </div>
            <div className="hvac-quick-add">
              <button className="hvac-btn" title="Add a VAV box with reheat" onClick={()=>addEquipTo(selected,'VAV w/ Reheat')}><Plus size={13}/> VAV</button>
              <button className="hvac-btn" title="Add a fan coil unit" onClick={()=>addEquipTo(selected,'Fan Coil')}><Plus size={13}/> FCU</button>
              <button className="hvac-btn" title="Add a square diffuser delivering separate outdoor air" onClick={()=>addEquipTo(selected,OA_DIFFUSER)}><Plus size={13}/> OA</button>
              <select className="hvac-btn" value="" aria-label="Add other equipment" onChange={e=>{if(e.target.value)addEquipTo(selected,e.target.value);e.currentTarget.blur();}}>
                <option value="">More</option>{EQUIP_TYPES.filter(t=>!['VAV w/ Reheat','Fan Coil',OA_DIFFUSER].includes(t.type)).map(t=><option key={t.type}>{t.type}</option>)}</select>
            </div>
            {!selected.equipment.length&&<p className="hvac-muted">New units are sized for whatever load is left, placed in an open spot, and drawn on the plan. Drag them into position, or press {sc('equip')} and click in any room.</p>}
            {selected.equipment.map((e,k)=>{const res=m.equip[k],t=equipType(e.type),open=e.id===selectedEquip,oa=e.method==='oa';
              const up=(ch:Partial<Equip>)=>updateEquipIn(selected.id,e.id,ch);
              const toggle=()=>open?setSelectedEquip(null):selectEquip(selected.id,e.id);
              const headNum=e.method==='capacity'?btu(e.cools?e.coolCap:e.heatCap):cfm(equipSupply(e));
              return <div key={e.id} ref={el=>{if(el)cardRefs.current.set(e.id,el);else cardRefs.current.delete(e.id);}}
                className={`hvac-eqcard${open?' open':''}${e.id===hoverEquip?' hover':''}`} onMouseEnter={()=>setHoverEquip(e.id)} onMouseLeave={()=>setHoverEquip(null)}>
                <div className="hvac-eqcard-head" role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
                  onKeyDown={ev=>{if(ev.key==='Enter'){ev.preventDefault();toggle();}}}>
                  <ChevronRight size={13} className="hvac-chev"/>
                  <span className="hvac-swatch" style={{background:styleOf(e.type).color,borderRadius:oa?1:3}}/>
                  <strong>{e.tag||t.prefix}</strong><span className="hvac-eqcard-type">{e.type}</span>
                  <span className="hvac-eqcard-num">{headNum}</span>
                  <button className="hvac-btn icon-only" title={`Remove ${e.tag||e.type}`} onClick={ev=>{ev.stopPropagation();removeEquip(selected.id,e.id);}}><Trash2 size={13}/></button>
                </div>
                {open&&<div className="hvac-eqcard-body">
                  <div className="hvac-grid2">
                    <div className="hvac-field"><label>Type</label><select value={e.type} onChange={ev=>{const d=newEquip(ev.target.value);
                      up({...d,id:e.id,tag:e.tag,pos:e.pos,rot:e.rot,coolCfm:e.coolCfm,heatCfm:e.heatCfm,coolCap:e.coolCap,heatCap:e.heatCap});}}>
                      {EQUIP_TYPES.map(x=><option key={x.type}>{x.type}</option>)}</select></div>
                    <div className="hvac-field"><label>Tag</label><input value={e.tag} onChange={ev=>up({tag:ev.target.value})}/></div>
                  </div>
                  {oa?<>
                    <div className="hvac-field"><label>Outdoor air (cfm)</label><NumField value={e.coolCfm} onChange={v=>up({coolCfm:v,heatCfm:v})}/></div>
                    <div className="hvac-grid2">
                      <div className="hvac-field"><label>Summer LAT (°F)</label><NumField value={e.coolLat} min={-100} onChange={v=>up({coolLat:v})}/></div>
                      <div className="hvac-field"><label>Winter LAT (°F)</label><NumField value={e.heatLat} min={-100} onChange={v=>up({heatLat:v})}/></div>
                    </div>
                    <div className="hvac-muted hvac-eq-line">Cooling effect {btu(res.cool)} · heating effect {btu(res.heatToRoom)}{res.heatToRoom<0?' (adds to the heating load)':''}</div>
                  </>:e.method==='air'?<>
                    <div className="hvac-checks"><label><input type="checkbox" checked={e.cools} onChange={ev=>up({cools:ev.target.checked})}/> Cooling</label>
                      <label><input type="checkbox" checked={e.heats} onChange={ev=>up({heats:ev.target.checked})}/> Heating</label></div>
                    {e.cools&&<><div className="hvac-grid3">
                      <div className="hvac-field"><label>Cooling cfm</label><NumField value={e.coolCfm} onChange={v=>up(e.type==='Fan Coil'?{coolCfm:v,heatCfm:v}:{coolCfm:v})}/></div>
                      <div className="hvac-field"><label>LAT (°F)</label><NumField value={e.coolLat} min={-100} onChange={v=>up({coolLat:v})}/></div>
                      <div className="hvac-field"><label>% OA</label><NumField value={e.oaPct} onChange={v=>up({oaPct:Math.min(100,v)})}/></div></div>
                      <div className="hvac-muted hvac-eq-line">Sensible cooling {btu(res.cool)} · OA {cfm(res.oa)}</div></>}
                    {e.heats&&<><div className="hvac-grid3">
                      <div className="hvac-field"><label>Heating cfm</label><NumField value={e.heatCfm} onChange={v=>up(e.type==='Fan Coil'?{coolCfm:v,heatCfm:v}:{heatCfm:v})}/></div>
                      <div className="hvac-field"><label>EAT (°F)</label><NumField value={e.heatEat} min={-100} onChange={v=>up({heatEat:v})}/></div>
                      <div className="hvac-field"><label>LAT (°F)</label><NumField value={e.heatLat} min={-100} onChange={v=>up({heatLat:v})}/></div></div>
                      {!e.cools&&<div className="hvac-field"><label>% OA</label><NumField value={e.oaPct} onChange={v=>up({oaPct:Math.min(100,v)})}/></div>}
                      <div className="hvac-muted hvac-eq-line">To room {btu(res.heatToRoom)} · <strong>Coil {fmt(res.coil/1000)} MBH</strong> ({fmt(res.coil/BTUH_PER_W/1000)} kW)</div>
                      {res.ezWarning&&<div className="hvac-warn-note">LAT is ≥15 °F above the space: with ceiling supply and return, Ez drops to 0.8 (ASHRAE 62.1 Table 6-4).</div>}</>}
                    {e.cools&&e.heats&&e.heatCfm>0&&e.heatCfm<e.coolCfm&&e.oaPct>0&&<div className="hvac-muted hvac-eq-line">OA is counted at the heating (minimum) airflow.</div>}
                  </>:<div className="hvac-grid2">
                    <div className="hvac-checks" style={{gridColumn:'1 / -1'}}><label><input type="checkbox" checked={e.cools} onChange={ev=>up({cools:ev.target.checked})}/> Cooling</label>
                      <label><input type="checkbox" checked={e.heats} onChange={ev=>up({heats:ev.target.checked})}/> Heating</label></div>
                    {e.cools&&<div className="hvac-field"><label>Cooling capacity (BTU/h)</label><NumField value={e.coolCap} onChange={v=>up({coolCap:v})}/></div>}
                    {e.heats&&<div className="hvac-field"><label>Heating capacity (BTU/h)</label><NumField value={e.heatCap} onChange={v=>up({heatCap:v})}/></div>}
                  </div>}
                  <div className="hvac-eqcard-size">
                    <span className="hvac-muted">Symbol (ft)</span>
                    <NumField value={equipSize(e).w} min={0.25} title="Width (ft)" onChange={v=>up({size:{...equipSize(e),w:v}})}/><span className="hvac-muted">×</span>
                    <NumField value={equipSize(e).h} min={0.25} title="Depth (ft)" onChange={v=>up({size:{...equipSize(e),h:v}})}/>
                    <button className="hvac-btn icon-only" title="Rotate 90°" onClick={()=>{pushHistory();up({rot:((e.rot??0)+90)%180});}}><RotateCw size={14}/></button>
                  </div>
                  <div className="hvac-eqcard-actions">
                    <button className="hvac-btn" title="Duplicate (Ctrl/Cmd+D)" onClick={()=>cloneInto(e,selected)}><Copy size={13}/> Duplicate</button>
                    <button className="hvac-btn hvac-btn-del" title="Delete (Del)" onClick={()=>removeEquip(selected.id,e.id)}><Trash2 size={13}/> Delete</button>
                  </div>
                </div>}
              </div>;})}
            <div className="hvac-subhead">Design conditions</div>
            <div className="hvac-grid2">
              <div className="hvac-field"><label>Cooling setpoint (°F)</label><NumField value={selected.coolSetpoint} onChange={v=>updateRoom({coolSetpoint:v})}/></div>
              <div className="hvac-field"><label>Heating setpoint (°F)</label><NumField value={selected.heatSetpoint} onChange={v=>updateRoom({heatSetpoint:v})}/></div>
            </div>
            <div className="hvac-row"><span>Cooling load (from Loads)</span><strong>{btu(m.coolingLoad)}</strong></div>
            <div className="hvac-field"><label>Heating load</label><div className="hvac-inline">
              <NumField value={selected.heatingLoad.value} onChange={v=>updateRoom({heatingLoad:{...selected.heatingLoad,value:v}})}/>
              <select value={selected.heatingLoad.unit} onChange={e=>updateRoom({heatingLoad:{...selected.heatingLoad,unit:e.target.value as LoadUnit}})}>{LOAD_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
              {selected.heatingLoad.unit!=='BTU/h'&&<div className="hvac-muted hvac-load-eq">= {btu(m.heatingLoad)}</div>}</div>
            {m.coilTotal>0&&<div className="hvac-row"><span>Total heating coil</span><strong>{`${fmt(m.coilTotal/1000)} MBH · ${fmt(m.coilTotal/BTUH_PER_W/1000)} kW`}</strong></div>}
            <p className="hvac-muted">Q = {m.factor.toFixed(3)} × cfm × ΔT{altitudeFt>0?` (1.08 corrected for ${fmt(altitudeFt)} ft)`:''}. Coil = {m.factor.toFixed(3)} × heating cfm × (LAT − EAT).</p>
          </Section>
          </>;})()}
      </SidePanel>
    </div>
    {reportsOpen&&<Reports rooms={rooms} feetPerPoint={feetPerPoint} altitudeFt={altitudeFt} projectName={projectName} saved={settings.reports}
      setSaved={next=>setSettings(st=>({...st,reports:next}))} templateName={templateName} onClose={()=>setReportsOpen(false)}/>}
    {settingsOpen&&<div className="hvac-modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget){setSettingsOpen(false);setCapturing(null);}}}>
      <div className="hvac-modal" role="dialog" aria-label="Settings">
        <header><strong>Settings</strong><IconBtn tip="Close (Esc)" onClick={()=>{setSettingsOpen(false);setCapturing(null);}}><X size={17}/></IconBtn></header>
        <section>
          <h4>Keyboard shortcuts</h4>
          <p className="hvac-muted">Click a key, then press the new key. If it's already in use, the two actions swap keys.</p>
          {ACTIONS.map(a=><div className="hvac-row" key={a.id}><span>{a.label}</span>
            <button className={`hvac-key${capturing===a.id?' capturing':''}`} onClick={()=>{setCapturing(capturing===a.id?null:a.id);setCaptureNote('');}}>{capturing===a.id?'Press a key…':keyLabel(settings.shortcuts[a.id])}</button></div>)}
          {captureNote&&<p className="hvac-note">{captureNote}</p>}
          <button className="hvac-btn" style={{marginTop:10}} onClick={()=>{setSettings(st=>({...st,shortcuts:{...DEFAULT_SHORTCUTS}}));setCapturing(null);setCaptureNote('Shortcuts reset to defaults.');}}>Reset to defaults</button>
        </section>
        <section>
          <h4>Controls</h4>
          <div className="hvac-fixed">
            <span>Draw ({sc('draw')})</span><span>Drag for a rectangle, or click corners for a polygon. Close by clicking the first corner, double-clicking, or Enter.</span>
            <span>Cutout ({sc('cutout')})</span><span>Same as Draw; the shape is removed from the room it sits in.</span>
            <span>Select ({sc('select')})</span><span>Click a room, label, wall or piece of equipment. Drag a room to move it (with its equipment), a wall to resize, a label or its corner handle to move or resize it. Shift/Ctrl-click adds rooms to the selection. Drag on empty space to box-select: left→right picks rooms fully inside, right→left picks anything the box touches.</span>
            <span>Equipment ({sc('equip')})</span><span>Click inside a room to place. Drag a symbol to move it, even into another room.</span>
            <span>Wheel</span><span>Zoom</span>
            <span>{sc('fit')}</span><span>Fit page</span>
          </div>
          <p className="hvac-muted" style={{marginTop:8}}>Trace inside wall faces. Verify the printed scale against a known dimension before relying on areas.</p>
        </section>
        <section>
          <h4>Equipment colors</h4>
          <p className="hvac-muted">Symbol colour and fill opacity for each equipment type on the plan.</p>
          <div className="hvac-colors">
            {EQUIP_TYPES.map(t=>{const st=styleOf(t.type),set=(ch:Partial<{color:string;opacity:number}>)=>setSettings(x=>({...x,equipStyle:{...x.equipStyle,[t.type]:{...st,...ch}}}));
              return <div className="hvac-color-row" key={t.type}>
                <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true"><rect x="1" y="1" width={t.type===OA_DIFFUSER?16:28} height="16" rx={t.type===OA_DIFFUSER?0:2} fill={st.color} fillOpacity={st.opacity} stroke={st.color} strokeWidth="1.5"/>
                  {t.type===OA_DIFFUSER&&<path d="M1,1L17,17M17,1L1,17" stroke={st.color} strokeWidth="1"/>}</svg>
                <span>{t.type}</span>
                <input type="color" value={st.color} aria-label={`${t.type} colour`} onChange={e=>set({color:e.target.value})}/>
                <input type="range" min={0} max={100} step={5} value={Math.round(st.opacity*100)} aria-label={`${t.type} fill opacity`} onChange={e=>set({opacity:Number(e.target.value)/100})}/>
                <span className="hvac-color-pct">{Math.round(st.opacity*100)}%</span>
              </div>;})}
          </div>
          <button className="hvac-btn" style={{marginTop:10}} disabled={!Object.keys(settings.equipStyle).length} onClick={()=>setSettings(x=>({...x,equipStyle:{}}))}>Reset colors</button>
        </section>
        <section>
          <h4>Fixed keys</h4>
          <div className="hvac-fixed">
            <span>Space + drag</span><span>Pan the drawing</span>
            <span>Arrows</span><span>Nudge selected equipment, wall, label or room 1"</span>
            <span>+ / −</span><span>Resize the selected label</span>
            <span>Shift + Arrows</span><span>Nudge 1'-0"</span>
            <span>Enter</span><span>Finish polygon</span>
            <span>Backspace</span><span>Remove last corner / selected cutout</span>
            <span>Delete</span><span>Delete selected equipment, cutout or room</span>
            <span>Ctrl/Cmd + A</span><span>Select all rooms</span>
            <span>Shift (while dragging)</span><span>Move straight horizontally or vertically</span>
            <span>Ctrl/Cmd + D</span><span>Duplicate selected equipment</span>
            <span>Ctrl/Cmd + C / V</span><span>Copy equipment / paste into the room under the cursor</span>
            <span>Esc</span><span>Cancel drawing, deselect a wall, then clear the selection</span>
            <span>Ctrl/Cmd + Z</span><span>Undo</span>
            <span>Ctrl/Cmd + S</span><span>Save project</span>
          </div>
        </section>
      </div>
    </div>}
    <footer className="hvac-status">{message} {dirty?" • Unsaved changes (Cmd+S)":""}</footer>
  </div>;
}
