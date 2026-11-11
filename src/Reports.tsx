import { useRef, useState } from 'react';
import { X, Save, SaveAll, Trash2, Upload, Download, Printer, RotateCcw, GripVertical, Plus, FileJson, FilePlus, Pencil } from 'lucide-react';
import { type Room, type Env, type Metrics, type Column, type ReportTemplate, BUILTIN_REPORTS, COLUMNS, COLUMN_BY_ID, metrics, formatCell, newId, fmtFu } from './rooms';
import { SCHEDULE_REPORT_ID, fixtureSchedule, OCCUPANCIES } from './plumbing';
import { wsfuTable, dfuTable, sourceLabel } from './reference';

const TEMPLATE_FILE_TYPE = 'hvac-studio-report-template';

type Props = {
  rooms: Room[];
  feetPerPoint: number | null;
  env: Env;
  projectName: string;
  saved: ReportTemplate[];                       // user report layouts (kept in this browser)
  setSaved: (next: ReportTemplate[]) => void;
  templateName: (id?: string | null) => string;  // room template id -> display name
  onClose: () => void;
  initialId?: string;                            // report to open on
};

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'report';

export default function Reports({ rooms, feetPerPoint, env, projectName, saved, setSaved, templateName, onClose, initialId }: Props) {
  const all = [...BUILTIN_REPORTS, ...saved];
  const [currentId, setCurrentId] = useState(initialId === SCHEDULE_REPORT_ID || all.some(t => t.id === initialId) ? initialId! : all[0].id);
  const schedule = currentId === SCHEDULE_REPORT_ID; // per fixture type, not per room
  const current = all.find(t => t.id === currentId) ?? all[0];
  const [cols, setCols] = useState<string[]>(current.columns);
  const [byEquip, setByEquip] = useState(!!current.byEquip); // one row per piece of equipment
  const [note, setNote] = useState('');
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dirty = cols.join() !== current.columns.join() || byEquip !== !!current.byEquip;

  const columns = cols.map(id => COLUMN_BY_ID.get(id)).filter(c => !!c);
  const rows = rooms.map(r => ({ r, m: metrics(r, feetPerPoint, env) }));
  const ctx = { tpl: templateName };
  // One row per unit: per-unit columns are worked out for that unit alone; room columns span the room's units.
  type Line = { r: Room; m: Metrics; key: string; unit: { r: Room; m: Metrics } | null; first: boolean; span: number };
  const lines: Line[] = rows.flatMap(({ r, m }): Line[] => !byEquip || r.equipment.length < 1 ? [{ r, m, key: r.id, unit: null, first: true, span: 1 }]
    : r.equipment.map((e, i) => { const ur = { ...r, equipment: [e] }; return { r, m, key: e.id, unit: { r: ur, m: metrics(ur, feetPerPoint, env) }, first: i === 0, span: r.equipment.length }; }));
  const lines_ = lines;
  const cellValue = (l: Line, c: Column) => c.perEquip && byEquip ? (l.unit ? c.get(l.unit.r, l.unit.m, ctx) : null) : l.first ? c.get(l.r, l.m, ctx) : null;
  const unitCount = rows.reduce((t, { r }) => t + r.equipment.length, 0);
  const totals = columns.map(c => c.sum ? rows.reduce<number | null>((t, { r, m }) => {
    const v = c.get(r, m, ctx); return typeof v === 'number' ? (t ?? 0) + v : t;
  }, null) : null);

  function choose(id: string) {
    if (dirty && !window.confirm('Discard your unsaved column changes?')) return;
    const t = all.find(x => x.id === id) ?? all[0];
    setCurrentId(id); setCols(t.columns); setByEquip(!!t.byEquip); setNote('');
  }
  function saveAs() {
    const name = window.prompt('Name for this report layout:', current.builtin ? `${current.name} (custom)` : current.name);
    if (!name?.trim()) return;
    const t: ReportTemplate = { id: `r-${newId()}`, name: name.trim(), columns: cols, byEquip };
    setSaved([...saved, t]); setCurrentId(t.id); setNote(`Saved "${t.name}". It's available in every project in this browser.`);
  }
  function newReport() {
    if (dirty && !window.confirm('Discard your unsaved column changes?')) return;
    const name = window.prompt('Name for the new report:', 'New report');
    if (!name?.trim()) return;
    const t: ReportTemplate = { id: `r-${newId()}`, name: name.trim(), columns: ['name', 'area'] };
    setSaved([...saved, t]); setCurrentId(t.id); setCols(t.columns); setByEquip(false); setNote(`Created "${t.name}". Add columns with "Add column…".`);
  }
  function rename() {
    const name = window.prompt(current.builtin ? 'Standard reports keep their name. Save a copy named:' : 'Rename report:', current.name);
    if (!name?.trim() || name.trim() === current.name) return;
    if (current.builtin) {
      const t: ReportTemplate = { id: `r-${newId()}`, name: name.trim(), columns: cols, byEquip };
      setSaved([...saved, t]); setCurrentId(t.id); setNote(`Saved a copy as "${t.name}".`);
    } else {
      setSaved(saved.map(t => t.id === current.id ? { ...t, name: name.trim() } : t)); setNote(`Renamed to "${name.trim()}".`);
    }
  }
  function save() {
    if (current.builtin) { saveAs(); return; }
    setSaved(saved.map(t => t.id === current.id ? { ...t, columns: cols, byEquip } : t)); setNote(`Saved "${current.name}".`);
  }
  function remove() {
    if (current.builtin || !window.confirm(`Delete the report layout "${current.name}"?`)) return;
    setSaved(saved.filter(t => t.id !== current.id)); setCurrentId(BUILTIN_REPORTS[0].id); setCols(BUILTIN_REPORTS[0].columns); setByEquip(false); setNote('');
  }
  function exportTemplate() {
    download(JSON.stringify({ type: TEMPLATE_FILE_TYPE, version: 1, name: current.name, columns: cols, byEquip }, null, 2), `${safeFile(current.name)}.hvacreport.json`, 'application/json');
  }
  async function importTemplate(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (data?.type !== TEMPLATE_FILE_TYPE || !Array.isArray(data.columns)) throw new Error('not a report template');
      const known = data.columns.filter((c: unknown) => typeof c === 'string' && COLUMN_BY_ID.has(c)) as string[];
      if (!known.length) throw new Error('no usable columns');
      let name = String(data.name || 'Imported report').trim(), n = 2;
      const base = name;
      while (all.some(t => t.name === name)) name = `${base} (${n++})`;
      const t: ReportTemplate = { id: `r-${newId()}`, name, columns: known, byEquip: !!data.byEquip };
      setSaved([...saved, t]); setCurrentId(t.id); setCols(known); setByEquip(!!data.byEquip);
      const skipped = data.columns.length - known.length;
      setNote(`Imported "${name}".${skipped ? ` ${skipped} unknown column(s) were skipped.` : ''}`);
    } catch { setNote('That file is not an HVAC Studio report template.'); }
  }
  // Plumbing fixture schedule
  const sched = fixtureSchedule(rooms.flatMap(r => r.fixtures ?? []), env.fixtureTypes ?? []);
  const sTot = sched.reduce((a, x) => ({ count: a.count + x.count, cold: a.cold + x.totCold, hot: a.hot + x.totHot, dfu: a.dfu + x.totDfu, wsfu: a.wsfu + x.totWsfu }), { count: 0, cold: 0, hot: 0, dfu: 0, wsfu: 0 });
  const occ = (o: string) => OCCUPANCIES.find(x => x[0] === o)?.[1] ?? o;
  const SCHED_HEAD = ['Tag', 'Fixture', 'Occupancy', 'Qty', 'Cold WSFU (each)', 'Hot WSFU (each)', 'Waste DFU (each)', 'Total Cold WSFU', 'Total Hot WSFU', 'Total Waste DFU'];
  function exportCsv() {
    if (schedule) {
      const r2 = (v: number) => Number(v.toFixed(2));
      const lines: (string | number)[][] = [SCHED_HEAD, ...sched.map(x => [x.t.tag, x.t.name, occ(x.t.occ), x.count, r2(x.cold), r2(x.hot), r2(x.dfu), r2(x.totCold), r2(x.totHot), r2(x.totDfu)]),
        ['Total', '', '', sTot.count, '', '', '', r2(sTot.cold), r2(sTot.hot), r2(sTot.dfu)], ['Combined total WSFU (sum of each fixture total)', '', '', '', '', '', '', r2(sTot.wsfu), '', '']];
      download(lines.map(l => l.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n'), 'Plumbing Fixture Schedule.csv', 'text/csv'); return;
    }
    const raw = (v: number | string | null, dec = 1) => v === null ? '' : typeof v === 'number' ? Number(v.toFixed(dec)) : v;
    // By equipment, room values appear on the room's first unit row only, so the column still adds up.
    const lines: (string | number)[][] = [columns.map(c => c.label), ...lines_.map(l => columns.map(c => raw(!l.first && c.id === 'name' ? l.r.name : cellValue(l, c), c.dec ?? 1)))]; // room name repeats so the CSV sorts/filters
    if (rows.length && totals.some(t => t !== null)) lines.push(columns.map((c, i) => i === 0 && !c.sum ? 'Total' : raw(totals[i], c.dec ?? 1)));
    download(lines.map(l => l.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n'), `${safeFile(current.name)}.csv`, 'text/csv');
  }
  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...cols]; const [c] = next.splice(from, 1); next.splice(to > from ? to - 1 : to, 0, c); setCols(next);
  }
  const unused = COLUMNS.filter(c => !cols.includes(c.id));
  const groups = [...new Set(unused.map(c => c.group))];

  return <div className="hvac-reports" role="dialog" aria-label="Reports">
    <div className="hvac-reports-bar">
      <strong>Reports</strong>
      <select value={currentId} onChange={e => choose(e.target.value)} aria-label="Report">
        <optgroup label="Standard">{BUILTIN_REPORTS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value={SCHEDULE_REPORT_ID}>Plumbing Fixture Schedule</option></optgroup>
        {saved.length > 0 && <optgroup label="My reports">{saved.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
      </select>
      {dirty && !schedule && <span className="hvac-dirty">Unsaved layout</span>}
      <div className="hvac-reports-actions">
        {!schedule && <>
        <button className="hvac-btn" title="Start a new report from scratch" onClick={newReport}><FilePlus size={15} /> New</button>
        <button className="hvac-btn" title={current.builtin ? 'Standard reports keep their name: saves a renamed copy' : 'Rename this report'} onClick={rename}><Pencil size={15} /> Rename</button>
        <button className="hvac-btn" title={current.builtin ? 'Standard reports are read-only: saves a copy' : 'Save layout'} onClick={save} disabled={!dirty && !current.builtin}><Save size={15} /> Save</button>
        <button className="hvac-btn" onClick={saveAs}><SaveAll size={15} /> Save as…</button>
        <button className="hvac-btn" onClick={() => { setCols(current.columns); setByEquip(!!current.byEquip); }} disabled={!dirty}><RotateCcw size={15} /> Reset</button>
        {!current.builtin && <button className="hvac-btn" onClick={remove}><Trash2 size={15} /> Delete</button>}
        <span className="hvac-sep" />
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importTemplate(f); e.target.value = ''; }} />
        <button className="hvac-btn" title="Import a report template file" onClick={() => importRef.current?.click()}><Upload size={15} /> Import template</button>
        <button className="hvac-btn" title="Save this column layout as a file to use on other computers" onClick={exportTemplate}><FileJson size={15} /> Export template</button>
        <span className="hvac-sep" /></>}
        <button className="hvac-btn" onClick={exportCsv} disabled={schedule ? !sched.length : !rooms.length}><Download size={15} /> CSV</button>
        <button className="hvac-btn" onClick={() => window.print()} disabled={!rooms.length}><Printer size={15} /> Print</button>
        <button className="hvac-btn icon-only" title="Close reports (Esc)" onClick={onClose}><X size={17} /></button>
      </div>
    </div>
    {schedule ? <div className="hvac-columns"><span className="hvac-muted">One row per fixture in the project list (Libraries → Plumbing fixtures). Counts come from fixtures placed on the plan.</span></div> :
    <div className="hvac-columns">
      <div className="hvac-seg" role="group" aria-label="Rows">
        <span className="hvac-muted">Rows:</span>
        <button className={!byEquip ? 'on' : ''} aria-pressed={!byEquip} onClick={() => setByEquip(false)}>One per room</button>
        <button className={byEquip ? 'on' : ''} aria-pressed={byEquip} title="Each piece of equipment on its own line" onClick={() => setByEquip(true)}>One per unit</button>
      </div>
      <span className="hvac-sep" />
      <span className="hvac-muted">Columns — drag to reorder:</span>
      {cols.map((id, i) => {
        const c = COLUMN_BY_ID.get(id); if (!c) return null;
        return <span key={id} className={`hvac-chip${dragOver === i ? ' drop' : ''}`} draggable
          onDragStart={e => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={e => { e.preventDefault(); setDragOver(i); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={e => { e.preventDefault(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; setDragOver(null); }}
          onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}>
          <GripVertical size={12} />{c.label}
          <button title={`Remove ${c.label}`} aria-label={`Remove ${c.label}`} onClick={() => setCols(cols.filter(x => x !== id))}><X size={12} /></button>
        </span>;
      })}
      <span className={`hvac-chip hvac-chip-end${dragOver === cols.length ? ' drop' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(cols.length); }} onDragLeave={() => setDragOver(null)}
        onDrop={e => { e.preventDefault(); if (dragFrom.current !== null) move(dragFrom.current, cols.length); dragFrom.current = null; setDragOver(null); }}>
        <Plus size={12} />
        <select value="" aria-label="Add column" onChange={e => { if (e.target.value) setCols([...cols, e.target.value]); }}>
          <option value="">Add column…</option>
          {groups.map(g => <optgroup key={g} label={g}>{unused.filter(c => c.group === g).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>)}
        </select>
      </span>
    </div>}
    {note && <div className="hvac-note hvac-reports-note">{note}</div>}
    <div className="hvac-reports-body">
      <div className="hvac-report-sheet">
        {schedule ? <>
        <div className="hvac-report-title">
          <div><h2>Plumbing Fixture Schedule</h2><span>{projectName.replace(/\.hvac\.json$|\.json$/, '')}</span></div>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        {!sched.length ? <p className="hvac-muted">No fixtures in the project list yet. Pick them in Libraries → Plumbing fixtures.</p> :
          <table className="hvac-report-table hvac-schedule">
            <thead>
              <tr><th className="txt" rowSpan={2}>Tag</th><th className="txt" rowSpan={2}>Fixture</th><th className="txt" rowSpan={2}>Occupancy</th><th rowSpan={2}>Qty</th>
                <th colSpan={3} className="grp">Each fixture</th><th colSpan={3} className="grp">Total</th></tr>
              <tr><th>Cold WSFU</th><th>Hot WSFU</th><th>Waste DFU</th><th>Cold WSFU</th><th>Hot WSFU</th><th>Waste DFU</th></tr>
            </thead>
            <tbody>{sched.map(x => <tr key={x.t.id} className={x.count ? undefined : 'zero'}>
              <td className="txt"><strong>{x.t.tag}</strong></td><td className="txt">{x.t.name}</td><td className="txt">{occ(x.t.occ)}</td><td>{x.count}</td>
              <td>{fmtFu(x.cold)}</td><td>{fmtFu(x.hot)}</td><td>{fmtFu(x.dfu)}</td>
              <td className="sep">{fmtFu(x.totCold)}</td><td>{fmtFu(x.totHot)}</td><td>{fmtFu(x.totDfu)}</td></tr>)}</tbody>
            <tfoot><tr><td className="txt">Total</td><td /><td /><td>{sTot.count}</td><td /><td /><td />
              <td className="sep">{fmtFu(sTot.cold)}</td><td>{fmtFu(sTot.hot)}</td><td>{fmtFu(sTot.dfu)}</td></tr></tfoot>
          </table>}
        <p className="hvac-report-legend" style={{ display: 'block', maxWidth: 900 }}>Combined supply load: <strong>{fmtFu(sTot.wsfu)} WSFU</strong> (sum of each fixture's total WSFU). Cold and hot are each ¾ of the total for fixtures with both supplies (Table 610.3 footnote), so cold + hot is more than the combined total.
          Sources: {sourceLabel(wsfuTable.meta)}; {sourceLabel(dfuTable.meta)}.</p>
        </> : <>
        <div className="hvac-report-title">
          <div><h2>{current.name} Report</h2><span>{projectName.replace(/\.hvac\.json$|\.json$/, '')}</span></div>
          <span>{byEquip ? `${unitCount} unit${unitCount === 1 ? '' : 's'} in ${rows.length} room${rows.length === 1 ? '' : 's'} · ` : ''}{new Date().toLocaleDateString()}{feetPerPoint === null ? ' · drawing not scaled: areas unavailable' : ''}</span>
        </div>
        {!rooms.length ? <p className="hvac-muted">No rooms in this project yet.</p> :
          <table className="hvac-report-table">
            <thead><tr>{columns.map(c => <th key={c.id} className={c.id === 'name' || c.id === 'template' ? 'txt' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>{lines.map(l => <tr key={l.key} className={byEquip && l.first && l.span > 1 ? 'grp-start' : byEquip && !l.first ? 'grp-cont' : undefined}>{columns.map(c => {
              const unitCell = byEquip && !!c.perEquip;
              if (!unitCell && !l.first) return null; // room value spans the room's unit rows
              const v = cellValue(l, c), bad = !unitCell && c.flag?.(l.r, l.m);
              return <td key={c.id} rowSpan={!unitCell && l.span > 1 ? l.span : undefined} className={`${typeof v === 'string' ? 'txt' : ''}${bad ? ' bad' : ''}${!unitCell && l.span > 1 ? ' span' : ''}`} title={bad ? 'Below requirement' : undefined}>{formatCell(v, c.dec ?? 1)}</td>;
            })}</tr>)}</tbody>
            {totals.some(t => t !== null) && <tfoot><tr>{columns.map((c, i) => <td key={c.id} className={i === 0 && !c.sum ? 'txt' : ''}>{i === 0 && !c.sum ? 'Total' : totals[i] === null ? '' : formatCell(totals[i], c.dec ?? 1)}</td>)}</tr></tfoot>}
          </table>}
        <p className="hvac-report-legend"><span className="bad-swatch" /> Red values are below the room's requirement (outdoor air or exhaust) or don't match the pressure target.</p>
        </>}
      </div>
    </div>
  </div>;
}
