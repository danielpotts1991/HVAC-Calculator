// Tools, keyboard shortcuts and per-browser settings.
import type { RoomTemplate, ReportTemplate } from './rooms';
import type { ModuleId } from './modules/types';

export type Tool = 'select' | 'draw' | 'cutout' | 'equip' | 'fixture' | 'calibrate';

// ---- Keyboard shortcuts (rebindable in Settings, saved in this browser) ----
export type Action = 'select' | 'draw' | 'cutout' | 'equip' | 'fixture' | 'calibrate' | 'fit' | 'snap' | 'table';
export const ACTIONS: { id: Action; label: string; key: string }[] = [
  { id: 'select', label: 'Select tool', key: 's' },
  { id: 'draw', label: 'Draw room tool', key: 'f' },
  { id: 'cutout', label: 'Cutout tool', key: 'c' },
  { id: 'equip', label: 'Place mechanical equipment tool', key: 'e' },
  { id: 'fixture', label: 'Place plumbing fixture (press again to cycle fixtures)', key: 'w' },
  { id: 'calibrate', label: 'Calibrate scale', key: 'k' },
  { id: 'fit', label: 'Fit page to window', key: '0' },
  { id: 'table', label: 'Show / hide room table', key: 't' },
  { id: 'snap', label: 'Toggle 15° snap', key: 'g' },
];
export type Shortcuts = Record<Action, string>;
export const DEFAULT_SHORTCUTS = Object.fromEntries(ACTIONS.map(a => [a.id, a.key])) as Shortcuts;
// Keys with fixed meanings that can't be reassigned.
// R rotates the symbol being placed (or the selected one), so it can't be a tool shortcut.
export const RESERVED_KEYS = ['r', 'escape', 'enter', 'backspace', 'delete', 'tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control', 'alt', 'meta'];
export const keyLabel = (k: string) => !k ? '—' : k.length === 1 ? k.toUpperCase() : k;
export type AppSettings = { shortcuts: Shortcuts; pdfOpacity: number; leftOpen: boolean; rightOpen: boolean; sections: Record<string, boolean>; roomTemplates: RoomTemplate[]; reports: ReportTemplate[];
  equipStyle: Record<string, { color: string; opacity: number }>;
  activeModule: ModuleId;   // which calculation module is in front
  layers: Layers;
  table: { open: boolean; height: number; view: string | null }; // room table drawer under the plan (view null = follow the module)
};
// What's drawn on the plan.
export type Layers = { fills: boolean; labels: boolean; labelValues: boolean; equipment: boolean; fixtures: boolean };
export const DEFAULT_LAYERS: Layers = { fills: true, labels: true, labelValues: false, equipment: true, fixtures: true }; // per equipment type: symbol colour and fill opacity
export const DEFAULT_EQUIP_OPACITY = 0.15;
export const DEFAULT_SECTIONS: Record<string, boolean> = { drawing: false, wall: true, room: true, ashrae: true, airflow: true, loads: true, hvac: true, plumb: true,
  'set-project': true, 'set-ref': false, 'set-keys': false, 'set-controls': false, 'set-colors': false, 'set-fixed': false };
export const SETTINGS_KEY = 'hvac-studio-settings';
// Shortcuts saved by older versions: Draw room was R and Fit page was F. R is now reserved for rotate.
function migrateShortcuts(saved: Partial<Shortcuts> | undefined): Shortcuts {
  const s: Shortcuts = { ...DEFAULT_SHORTCUTS, ...(saved || {}) };
  if (saved?.draw === 'r') s.draw = DEFAULT_SHORTCUTS.draw;
  if (saved?.fit === 'f' && s.draw === 'f') s.fit = DEFAULT_SHORTCUTS.fit;
  if (saved?.fixture === 'p') s.fixture = DEFAULT_SHORTCUTS.fixture; // P moved to W (left hand)
  // Anything left on a reserved key, or sharing a key with another action, goes back to its default (or none).
  const used = new Set<string>();
  for (const a of ACTIONS) {
    let k = s[a.id];
    if (RESERVED_KEYS.includes(k) || used.has(k)) k = used.has(a.key) ? '' : a.key;
    s[a.id] = k; if (k) used.add(k);
  }
  return s;
}
export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { shortcuts: migrateShortcuts(raw.shortcuts), pdfOpacity: typeof raw.pdfOpacity === 'number' ? raw.pdfOpacity : 1,
      leftOpen: raw.leftOpen ?? true, rightOpen: raw.rightOpen ?? true, sections: { ...DEFAULT_SECTIONS, ...(raw.sections || {}) },
      roomTemplates: Array.isArray(raw.roomTemplates) ? raw.roomTemplates : [], reports: Array.isArray(raw.reports) ? raw.reports : [],
      equipStyle: raw.equipStyle && typeof raw.equipStyle === 'object' ? raw.equipStyle : {},
      activeModule: raw.activeModule === 'plumb' ? 'plumb' : 'hvac', layers: { ...DEFAULT_LAYERS, ...(raw.layers || {}) },
      table: { open: raw.table?.open ?? false, height: typeof raw.table?.height === 'number' ? raw.table.height : 240, view: typeof raw.table?.view === 'string' ? raw.table.view : null } };
  } catch { return { shortcuts: { ...DEFAULT_SHORTCUTS }, pdfOpacity: 1, leftOpen: true, rightOpen: true, sections: { ...DEFAULT_SECTIONS }, roomTemplates: [], reports: [], equipStyle: {},
    activeModule: 'hvac', layers: { ...DEFAULT_LAYERS }, table: { open: false, height: 240, view: null } }; }
}
// True when the key press belongs to a text/number field rather than the app.
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
  (t instanceof HTMLInputElement && !['range', 'checkbox', 'button'].includes(t.type));
