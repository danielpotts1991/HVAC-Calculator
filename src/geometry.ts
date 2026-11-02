// Pure geometry: points, polygons ("rings"), snapping, edge moves, drawing scales.
import { type Point, areaPx } from './rooms';

// Shared geometry and architectural-scale utilities.
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const scales = [
  ['1/16', '1/16" = 1\'-0"'],
  ['1/8', '1/8" = 1\'-0"'],
  ['3/16', '3/16" = 1\'-0"'],
  ['1/4', '1/4" = 1\'-0"'],
  ['3/8', '3/8" = 1\'-0"'],
  ['1/2', '1/2" = 1\'-0"'],
  ['custom', 'Custom calibration'],
] as const;
export const scaleFeetPerPoint = (scale: string): number => {
  const [numerator, denominator] = scale.split('/').map(Number);
  const inchesPerFoot = denominator ? numerator / denominator : numerator;
  return 1 / (72 * inchesPerFoot);
};

// Direction constraints are applied to geometry, not to a grid.
// The first vertex is the fixed anchor; later vertices are adjusted.
export const STEP = Math.PI / 12;
export function snapDirection(a: Point, raw: Point): Point {
  const dx = raw.x - a.x, dy = raw.y - a.y;
  const theta = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
  const ux = Math.cos(theta), uy = Math.sin(theta);
  // Project onto the snapped direction: this keeps horizontal/vertical edges
  // aligned without increasing their length when the mouse is slightly off.
  const length = Math.max(0, dx * ux + dy * uy);
  return { x: a.x + length * ux, y: a.y + length * uy };
}
export function cross(a: Point, b: Point) { return a.x * b.y - a.y * b.x; }
export function segmentIntersection(a: Point, ad: Point, b: Point, bd: Point): Point | null {
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
export function closeSnapped(points: Point[]): Point[] | null {
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

export function isSimplePolygon(points: Point[]): boolean {
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
export function properCross(a: Point, b: Point, c: Point, d: Point) {
  const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y };
  const denom = cross(ab, cd);
  if (Math.abs(denom) < 1e-8) return false;
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(ac, cd) / denom, u = cross(ac, ab) / denom;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}
export function ringsCross(r1: Point[], r2: Point[]) {
  for (let i = 0; i < r1.length; i++) for (let j = 0; j < r2.length; j++)
    if (properCross(r1[i], r1[(i + 1) % r1.length], r2[j], r2[(j + 1) % r2.length])) return true;
  return false;
}
export function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function onBoundary(p: Point, ring: Point[], tol = 0.5) {
  return ring.some((a, i) => distToSegment(p, a, ring[(i + 1) % ring.length]) <= tol);
}
export function pointInRing(p: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// inner lies inside outer: no wall crossings, every corner inside or on the outline,
// and every wall's midpoint inside (catches a shape that bridges across a notch).
export function ringInside(inner: Point[], outer: Point[]) {
  if (ringsCross(inner, outer)) return false;
  const ok = (p: Point) => pointInRing(p, outer) || onBoundary(p, outer);
  return inner.every((p, i) => {
    const q = inner[(i + 1) % inner.length];
    return ok(p) && ok({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  });
}
// A point guaranteed to be inside a ring (works for concave shapes too).
export function interiorPoint(r: Point[]): Point {
  for (let i = 1; i < r.length - 1; i++) {
    const c = { x: (r[0].x + r[i].x + r[i + 1].x) / 3, y: (r[0].y + r[i].y + r[i + 1].y) / 3 };
    if (pointInRing(c, r) && !onBoundary(c, r, 1e-6)) return c;
  }
  return r[0];
}
// Two cutouts may touch but not overlap (identical or nested shapes count as overlap).
export function ringsOverlap(a: Point[], b: Point[]) {
  if (ringsCross(a, b)) return true;
  const strictlyIn = (p: Point, r: Point[]) => pointInRing(p, r) && !onBoundary(p, r);
  return a.some(p => strictlyIn(p, b)) || b.some(p => strictlyIn(p, a))
    || strictlyIn(interiorPoint(a), b) || strictlyIn(interiorPoint(b), a);
}
// Move edge i of a ring along its own normal. Its two corners slide along the
// neighbouring walls, so those walls keep their angles (they just get longer/shorter).
export function edgeNormal(ring: Point[], i: number): Point | null {
  const a = ring[i], b = ring[(i + 1) % ring.length], len = dist(a, b);
  return len < 1e-9 ? null : { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}
export function offsetEdge(ring: Point[], i: number, arrow: Point, step: number): Point[] | null {
  const normal = edgeNormal(ring, i);
  if (!normal) return null;
  const along = arrow.x * normal.x + arrow.y * normal.y;
  if (Math.abs(along) < 0.3) return null; // arrow points along the wall: nothing to nudge
  return offsetEdgeBy(ring, i, step * Math.sign(along));
}
// Move edge i a signed distance along its normal; its corners slide along the neighbouring walls.
export function offsetEdgeBy(ring: Point[], i: number, distance: number): Point[] | null {
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
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export const inRect = (p: Point, b: Rect) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
// Crossing selection: the room touches the box at all.
export function ringTouchesRect(ring: Point[], b: Rect) {
  if (ring.some(p => inRect(p, b))) return true;
  const c = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  if (c.some(p => pointInRing(p, ring))) return true;
  return ringsCross(ring, c);
}
export const ringPath = (r: Point[]) => 'M' + r.map(p => `${p.x},${p.y}`).join('L') + 'Z';
export const fmtFeet = (feet: number) => {
  const totalIn = Math.round(feet * 12 * 4) / 4;
  const ft = Math.floor(totalIn / 12), inch = totalIn - ft * 12;
  const whole = Math.floor(inch), frac = ['', ' 1/4', ' 1/2', ' 3/4'][Math.round((inch - whole) * 4)];
  return `${ft}'-${whole}${frac}"`;
};
