import { useRef, useState } from 'react';
import { X, Save, SaveAll, Trash2, Upload, Download, Printer, RotateCcw, GripVertical, Plus, FileJson, FilePlus, Pencil } from 'lucide-react';
import { type Room, type ReportTemplate, BUILTIN_REPORTS, COLUMNS, COLUMN_BY_ID, metrics, formatCell, newId } from './rooms';

const TEMPLATE_FILE_TYPE = 'hvac-studio-report-template';

type Props = {
  rooms: Room[];
  feetPerPoint: number | null;
  altitudeFt: number;
  projectName: string;
  saved: ReportTemplate[];                       // user report layouts (kept in this browser)
  setSaved: (next: ReportTemplate[]) => void;
  templateName: (id?: string | null) => string;  // room template id -> display name
  onClose: () => void;
};

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'report';

export default function Reports({ rooms, feetPerPoint, altitudeFt, projectName, saved, setSaved, templateName, onClose }: Props) {
  const all = [...BUILTIN_REPORTS, ...saved];
  const [currentId, setCurrentId] = useState(all[0].id);
  const current = all.find(t => t.id === currentId) ?? all[0];
  const [cols, setCols] = useState<string[]>(current.columns);
  const [note, setNote] = useState('');
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dirty = cols.join() !== current.columns.join();

  const columns = cols.map(id => COLUMN_BY_ID.get(id)).filter(c => !!c);
  const rows = rooms.map(r => ({ r, m: metrics(r, feetPerPoint, altitudeFt) }));
  const ctx = { tpl: templateName };
  const totals = columns.map(c => c.sum ? rows.reduce<number | null>((t, { r, m }) => {
    const v = c.get(r, m, ctx); return typeof v === 'number' ? (t ?? 0) + v : t;
  }, null) : null);

  function choose(id: string) {
    if (dirty && !window.confirm('Discard your unsaved column changes?')) return;
    const t = all.find(x => x.id === id)!;
    setCurrentId(id); setCols(t.columns); setNote('');
  }
  function saveAs() {
    const name = window.prompt('Name for this report layout:', current.builtin ? `${current.name} (custom)` : current.name);
    if (!name?.trim()) return;
    const t: ReportTemplate = { id: `r-${newId()}`, name: name.trim(), columns: cols };
    setSaved([...saved, t]); setCurrentId(t.id); setNote(`Saved "${t.name}". It's available in every project in this browser.`);
  }
  function newReport() {
    if (dirty && !window.confirm('Discard your unsaved column changes?')) return;
    const name = window.prompt('Name for the new report:', 'New report');
    if (!name?.trim()) return;
    const t: ReportTemplate = { id: `r-${newId()}`, name: name.trim(), columns: ['name', 'area'] };
    setSaved([...saved, t]); setCurrentId(t.id); setCols(t.columns); setNote(`Created "${t.name}". Add columns with "Add column…".`);
  }
  function rename() {
    const name = window.prompt(current.builtin ? 'Standard reports keep their name. Save a copy named:' : 'Rename report:', current.name);
    if (!name?.trim() || name.trim() === current.name) return;
    if (current.builtin) {
      const t: ReportTemplate = { id: `r-${newId()}`, name: name.trim(), columns: cols };
      setSaved([...saved, t]); setCurrentId(t.id); setNote(`Saved a copy as "${t.name}".`);
    } else {
      setSaved(saved.map(t => t.id === current.id ? { ...t, name: name.trim() } : t)); setNote(`Renamed to "${name.trim()}".`);
    }
  }
  function save() {
    if (current.builtin) { saveAs(); return; }
    setSaved(saved.map(t => t.id === current.id ? { ...t, columns: cols } : t)); setNote(`Saved "${current.name}".`);
  }
  function remove() {
    if (current.builtin || !window.confirm(`Delete the report layout "${current.name}"?`)) return;
    setSaved(saved.filter(t => t.id !== current.id)); setCurrentId(BUILTIN_REPORTS[0].id); setCols(BUILTIN_REPORTS[0].columns); setNote('');
  }
  function exportTemplate() {
    download(JSON.stringify({ type: TEMPLATE_FILE_TYPE, version: 1, name: current.name, columns: cols }, null, 2), `${safeFile(current.name)}.hvacreport.json`, 'application/json');
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
      const t: ReportTemplate = { id: `r-${newId()}`, name, columns: known };
      setSaved([...saved, t]); setCurrentId(t.id); setCols(known);
      const skipped = data.columns.length - known.length;
      setNote(`Imported "${name}".${skipped ? ` ${skipped} unknown column(s) were skipped.` : ''}`);
    } catch { setNote('That file is not an HVAC Studio report template.'); }
  }
  function exportCsv() {
    const raw = (v: number | string | null, dec = 1) => v === null ? '' : typeof v === 'number' ? Number(v.toFixed(dec)) : v;
    const lines: (string | number)[][] = [columns.map(c => c.label), ...rows.map(({ r, m }) => columns.map(c => raw(c.get(r, m, ctx), c.dec ?? 1)))];
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
        <optgroup label="Standard">{BUILTIN_REPORTS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
        {saved.length > 0 && <optgroup label="My reports">{saved.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
      </select>
      {dirty && <span className="hvac-dirty">Unsaved layout</span>}
      <div className="hvac-reports-actions">
        <button className="hvac-btn" title="Start a new report from scratch" onClick={newReport}><FilePlus size={15} /> New</button>
        <button className="hvac-btn" title={current.builtin ? 'Standard reports keep their name: saves a renamed copy' : 'Rename this report'} onClick={rename}><Pencil size={15} /> Rename</button>
        <button className="hvac-btn" title={current.builtin ? 'Standard reports are read-only: saves a copy' : 'Save layout'} onClick={save} disabled={!dirty && !current.builtin}><Save size={15} /> Save</button>
        <button className="hvac-btn" onClick={saveAs}><SaveAll size={15} /> Save as…</button>
        <button className="hvac-btn" onClick={() => setCols(current.columns)} disabled={!dirty}><RotateCcw size={15} /> Reset</button>
        {!current.builtin && <button className="hvac-btn" onClick={remove}><Trash2 size={15} /> Delete</button>}
        <span className="hvac-sep" />
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importTemplate(f); e.target.value = ''; }} />
        <button className="hvac-btn" title="Import a report template file" onClick={() => importRef.current?.click()}><Upload size={15} /> Import template</button>
        <button className="hvac-btn" title="Save this column layout as a file to use on other computers" onClick={exportTemplate}><FileJson size={15} /> Export template</button>
        <span className="hvac-sep" />
        <button className="hvac-btn" onClick={exportCsv} disabled={!rooms.length}><Download size={15} /> CSV</button>
        <button className="hvac-btn" onClick={() => window.print()} disabled={!rooms.length}><Printer size={15} /> Print</button>
        <button className="hvac-btn icon-only" title="Close reports (Esc)" onClick={onClose}><X size={17} /></button>
      </div>
    </div>
    <div className="hvac-columns">
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
    </div>
    {note && <div className="hvac-note hvac-reports-note">{note}</div>}
    <div className="hvac-reports-body">
      <div className="hvac-report-sheet">
        <div className="hvac-report-title">
          <div><h2>{current.name} Report</h2><span>{projectName.replace(/\.hvac\.json$|\.json$/, '')}</span></div>
          <span>{new Date().toLocaleDateString()}{feetPerPoint === null ? ' · drawing not scaled: areas unavailable' : ''}</span>
        </div>
        {!rooms.length ? <p className="hvac-muted">No rooms in this project yet.</p> :
          <table className="hvac-report-table">
            <thead><tr>{columns.map(c => <th key={c.id} className={c.id === 'name' || c.id === 'template' ? 'txt' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map(({ r, m }) => <tr key={r.id}>{columns.map(c => {
              const v = c.get(r, m, ctx), bad = c.flag?.(r, m);
              return <td key={c.id} className={`${typeof v === 'string' ? 'txt' : ''}${bad ? ' bad' : ''}`} title={bad ? 'Below requirement' : undefined}>{formatCell(v, c.dec ?? 1)}</td>;
            })}</tr>)}</tbody>
            {totals.some(t => t !== null) && <tfoot><tr>{columns.map((c, i) => <td key={c.id} className={i === 0 && !c.sum ? 'txt' : ''}>{i === 0 && !c.sum ? 'Total' : totals[i] === null ? '' : formatCell(totals[i], c.dec ?? 1)}</td>)}</tr></tfoot>}
          </table>}
        <p className="hvac-report-legend"><span className="bad-swatch" /> Red values are below the room's requirement (outdoor air or exhaust) or don't match the pressure target.</p>
      </div>
    </div>
  </div>;
}
