// Room table: a spreadsheet-style drawer under the plan. One row per room, columns from any
// report layout. Click a row to select (and centre) the room; edit the common inputs in place.
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { X, ClipboardList, ArrowUp, ArrowDown } from 'lucide-react';
import { type Room, type Metrics, type ReportTemplate, type CellCtx, COLUMN_BY_ID, BUILTIN_REPORTS, formatCell, tidy } from './rooms';

type Props = {
  rooms: Room[];
  metricsOf: (r: Room) => Metrics;
  ctx: CellCtx;
  saved: ReportTemplate[];
  viewId: string; setViewId: (id: string) => void;
  selIds: string[];
  onRowClick: (id: string, additive: boolean) => void;
  onEdit: (id: string, ch: Partial<Room>) => void;   // one undo step per committed edit
  onOpenReports: (id: string) => void;
  onClose: () => void;
  height: number; setHeight: (h: number) => void;
  moduleName: string;
  following: boolean;                              // columns follow the active module
  onFollow: () => void;
};

type Sort = { id: string; dir: 1 | -1 } | null;

export default function RoomTable({ rooms, metricsOf, ctx, saved, viewId, setViewId, selIds, onRowClick, onEdit, onOpenReports, onClose, height, setHeight, moduleName, following, onFollow }: Props) {
  const all = [...BUILTIN_REPORTS, ...saved];
  const view = all.find(t => t.id === viewId) ?? all[0];
  const columns = view.columns.map(id => COLUMN_BY_ID.get(id)).filter(c => !!c);
  const [sort, setSort] = useState<Sort>(null);
  const [editing, setEditing] = useState<{ id: string; col: string; text: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const clickedHere = useRef(false); // selection came from a row click: don't scroll under the pointer

  const rows = rooms.map(r => ({ r, m: metricsOf(r) }));
  if (sort) {
    const c = COLUMN_BY_ID.get(sort.id);
    if (c) rows.sort((a, b) => {
      const va = c.get(a.r, a.m, ctx), vb = c.get(b.r, b.m, ctx);
      if (va === null) return 1; if (vb === null) return -1;           // blanks always last
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sort.dir;
    });
  }
  const totals = columns.map(c => c.sum ? rows.reduce<number | null>((t, { r, m }) => { const v = c.get(r, m, ctx); return typeof v === 'number' ? (t ?? 0) + v : t; }, null) : null);

  // Keep the selected room's row in view when it's selected on the plan.
  useEffect(() => {
    if (clickedHere.current) { clickedHere.current = false; return; }
    const id = selIds[selIds.length - 1]; if (!id || !bodyRef.current) return;
    bodyRef.current.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selIds]);

  function commit() {
    if (!editing) return;
    const c = COLUMN_BY_ID.get(editing.col);
    if (c?.edit) {
      if (c.edit.kind === 'number') { const n = Number(editing.text); if (editing.text.trim() !== '' && Number.isFinite(n) && n >= 0) onEdit(editing.id, c.edit.set(n)); }
      else if (editing.text.trim()) onEdit(editing.id, c.edit.set(editing.text.trim()));
    }
    setEditing(null);
  }
  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const y0 = e.clientY, h0 = height, max = Math.round(window.innerHeight * 0.7);
    const move = (ev: PointerEvent) => setHeight(Math.max(110, Math.min(max, h0 + y0 - ev.clientY)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  return <section className="hvac-table" style={{ height }} aria-label="Room table">
    <div className="hvac-table-grip" onPointerDown={startResize} title="Drag to resize" />
    <div className="hvac-table-bar">
      <strong>Rooms</strong>
      <select value={view.id} onChange={e => { setViewId(e.target.value); setSort(null); e.currentTarget.blur(); }} aria-label="Table columns">
        <optgroup label="Standard">{BUILTIN_REPORTS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
        {saved.length > 0 && <optgroup label="My reports">{saved.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
      </select>
      <span className="hvac-muted">{rows.length} room{rows.length === 1 ? '' : 's'} · {following ? `columns follow the ${moduleName} module` : 'fixed view'}</span>
      {!following && <button className="hvac-linkbtn" style={{ padding: 0, fontSize: 11 }} onClick={onFollow}>Follow module</button>}
      <span style={{ flex: 1 }} />
      <button className="hvac-btn" title="Open this view in Reports to print, export or change columns" onClick={() => onOpenReports(view.id)}><ClipboardList size={14} /> Open in Reports</button>
      <button className="hvac-btn icon-only" title="Close table (T)" onClick={onClose}><X size={16} /></button>
    </div>
    <div className="hvac-table-body" ref={bodyRef}>
      {!rows.length ? <p className="hvac-muted" style={{ padding: 14 }}>No rooms yet.</p> :
        <table>
          <thead><tr>{columns.map(c => <th key={c.id} className={typeof c.get(rows[0].r, rows[0].m, ctx) === 'string' ? 'txt' : ''}
            onClick={() => setSort(s => !s || s.id !== c.id ? { id: c.id, dir: 1 } : s.dir === 1 ? { id: c.id, dir: -1 } : null)}
            title="Click to sort">{c.label}{sort?.id === c.id && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}{c.edit && <span className="hvac-editable-dot" title="Editable" />}</th>)}</tr></thead>
          <tbody>{rows.map(({ r, m }) => <tr key={r.id} data-id={r.id} className={selIds.includes(r.id) ? 'sel' : undefined}
            onClick={e => { clickedHere.current = true; onRowClick(r.id, e.shiftKey || e.ctrlKey || e.metaKey); }}>
            {columns.map(c => {
              const v = c.get(r, m, ctx), bad = c.flag?.(r, m), isEdit = editing?.id === r.id && editing.col === c.id;
              return <td key={c.id} className={`${typeof v === 'string' ? 'txt' : ''}${bad ? ' bad' : ''}${c.edit ? ' editable' : ''}`}
                onDoubleClick={c.edit ? e => { e.stopPropagation(); setEditing({ id: r.id, col: c.id, text: String(typeof v === 'number' ? tidy(v) : v ?? '') }); } : undefined}
                title={c.edit ? 'Double-click to edit' : bad ? 'Below requirement' : undefined}>
                {isEdit ? <input autoFocus value={editing.text} type={c.edit!.kind === 'number' ? 'number' : 'text'} step="any"
                  onClick={e => e.stopPropagation()} onChange={e => setEditing({ ...editing, text: e.target.value })}
                  onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); e.stopPropagation(); }} />
                  : formatCell(v, c.dec ?? 1)}
              </td>;
            })}
          </tr>)}</tbody>
          {totals.some(t => t !== null) && <tfoot><tr>{columns.map((c, i) => <td key={c.id} className={i === 0 && !c.sum ? 'txt' : ''}>{i === 0 && !c.sum ? 'Total' : totals[i] === null ? '' : formatCell(totals[i], c.dec ?? 1)}</td>)}</tr></tfoot>}
        </table>}
    </div>
  </section>;
}
