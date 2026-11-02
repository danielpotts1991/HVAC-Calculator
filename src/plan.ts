// Placing things inside rooms on the plan: label anchors, free spots for equipment, moving rooms.
import { type Point, type Room, type Equip, DEFAULT_LABEL_SIZE, equipSize } from './rooms';
import { dist, distToSegment, pointInRing } from './geometry';

// Label anchor: the sampled point inside the room's net area that is farthest from any
// wall or cutout edge. For a plain rectangle that is the centre; with a cutout or a
// room drawn inside the cutout, the label moves into the remaining floor area.
export function labelPoint(room: Room): Point {
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
export type Obstacle = { p: Point; r: number };
export function labelObstacle(room: Room): Obstacle {
  const size = room.labelSize ?? DEFAULT_LABEL_SIZE;
  return { p: room.labelPos ?? labelPoint(room), r: Math.max(room.name.length, 9) * size * 0.3 + size * 0.5 };
}
// Clearance a symbol needs, in feet. OA diffusers carry their tag text below, wider than the square.
export const equipRadiusFt = (e: Equip) => Math.hypot(equipSize(e).w, equipSize(e).h) / 2 * (e.method === 'oa' ? 2.2 : 1);
export function equipObstacles(room: Room, ptPerFt: number, skip?: string): Obstacle[] {
  return room.equipment.flatMap(e => e.pos && e.id !== skip ? [{ p: e.pos, r: equipRadiusFt(e) * ptPerFt }] : []);
}
// Roomiest spot for a symbol of radius selfR: clear of walls, the label and other equipment.
export function freeSpot(room: Room, obstacles: Obstacle[], selfR: number): Point {
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
export function placeMissingEquipment(list: Room[], ptPerFt: number): Room[] {
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
export function translateRoom(r: Room, dx: number, dy: number): Room {
  const mv = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return { ...r, points: r.points.map(mv), cutouts: (r.cutouts ?? []).map(c => c.map(mv)), labelPos: r.labelPos ? mv(r.labelPos) : r.labelPos,
    equipment: r.equipment.map(e => e.pos ? { ...e, pos: mv(e.pos) } : e), fixtures: (r.fixtures ?? []).map(f => ({ ...f, pos: mv(f.pos) })) };
}
