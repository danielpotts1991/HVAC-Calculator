// A module is one calculation system layered on the shared base (drawing, rooms, selection, reports).
// The app shows one module at a time: its panel sections, its tools and its symbols are active;
// the others collapse to a one-line summary and their symbols are faded.
import type { ReactNode, RefObject } from 'react';
import type { Room, Metrics, Equip, RoomTemplate, Env } from '../rooms';
import type { FixtureType } from '../plumbing';
import type { Action, AppSettings } from '../settings';

export type ModuleId = 'hvac' | 'plumb';

// Everything a module's panel needs from the app. Passed explicitly so modules never reach into App state.
export type ModuleCtx = {
  room: Room; m: Metrics; tpl: RoomTemplate | undefined;
  settings: AppSettings; altitudeFt: number; env: Env;
  openSettings: (section?: string) => void;        // open Settings, optionally at a section
  openLibrary: (itemId?: string) => void;          // open the Equipment Library, optionally at an item
  addLibToRoom: (room: Room, itemId: string) => void;
  secOpen: (k: string) => boolean; toggleSec: (k: string) => void;
  updateRoom: (ch: Partial<Room>) => void; pushHistory: () => void;
  tag: (match: boolean) => ReactNode;            // "Template: Office" / "Template: Custom" chip
  cfm: (v: number | null) => string; btu: (v: number | null) => string;
  sc: (a: Action) => string;                     // current shortcut key for an action
  // Equipment
  selectedEquip: string | null; setSelectedEquip: (id: string | null) => void;
  hoverEquip: string | null; setHoverEquip: (id: string | null) => void;
  cardRefs: RefObject<Map<string, HTMLDivElement>>;
  selectEquip: (roomId: string, id: string) => void;
  addEquipTo: (room: Room, type: string) => void;
  removeEquip: (roomId: string, id: string) => void;
  updateEquipIn: (roomId: string, id: string, ch: Partial<Equip>) => void;
  cloneInto: (src: Equip, room: Room) => void;
  styleOf: (type: string) => { color: string; opacity: number };
  roundUp5: (v: number) => number;
  // Plumbing
  fixtureTypes: FixtureType[]; selectedFix: string | null;
  selectFixture: (roomId: string, id: string) => void;
  addFixtureTo: (room: Room, typeId: string) => void;
  removeFixture: (roomId: string, id: string) => void;
  openLibraries: () => void;                       // Libraries window, plumbing tab
  openSchedule: () => void;                        // Reports at the plumbing fixture schedule
  startPlacing: (typeId: string) => void;          // fixture tool with this type
};

export type ModuleDef = {
  id: ModuleId;
  name: string;                                  // full name, e.g. "Ventilation & Loads"
  short: string;                                 // switcher label
  Sections: (ctx: ModuleCtx) => ReactNode;       // its sections in the properties panel
  summary: (room: Room, m: Metrics) => { text: string; bad: boolean }; // one line when the module isn't active
  labelLine: (room: Room, m: Metrics) => { text: string; bad: boolean } | null; // optional extra line on room labels
  report: string;                                // built-in report the room table uses for this module
};
