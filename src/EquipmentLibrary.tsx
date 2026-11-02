// Equipment Library: custom equipment built from parts (monitors, motors, power supplies...).
// Items live in the project file; rooms reference them from their Loads section with a quantity,
// so changing an item here updates every room that uses it.
import { useRef, useState } from 'react';
import { Plus, Trash2, Copy, Upload, FileJson, PackagePlus } from 'lucide-react';
import { type LibItem, type LibPart, type PowerInput, BTUH_PER_W, fmt, newId, newLibItem, newPart, partInputW, partHeatW, itemInputW, itemHeatW, normalizeLibrary } from './rooms';
import { NumField } from './ui';

const FILE_TYPE = 'hvac-studio-equipment-library';
const INPUTS: [PowerInput, string][] = [['W', 'Watts'], ['VA', 'Volts × amps'], ['HP', 'Motor HP']];

type Props = {
  library: LibItem[];
  setLibrary: (next: LibItem[]) => void;
  usage: (id: string) => { room: string; qty: number }[];
  initialId: string | null;
  onDeleteItem: (id: string) => void;            // also removes it from rooms (with undo)
  selectedRoom: string | null;                   // name of the selected room, if any
  onAddToRoom: (id: string) => void;
};

export default function EquipmentLibrary({ library, setLibrary, usage, initialId, onDeleteItem, selectedRoom, onAddToRoom }: Props) {
  const [currentId, setCurrentId] = useState<string | null>(initialId ?? library[0]?.id ?? null);
  const [note, setNote] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const item = library.find(i => i.id === currentId) ?? null;

  const updateItem = (ch: Partial<LibItem>) => item && setLibrary(library.map(i => i.id === item.id ? { ...i, ...ch } : i));
  const updatePart = (pid: string, ch: Partial<LibPart>) => item && updateItem({ parts: item.parts.map(p => p.id === pid ? { ...p, ...ch } : p) });
  function add() { const it = newLibItem(); setLibrary([...library, it]); setCurrentId(it.id); setNote(''); }
  function duplicate() {
    if (!item) return;
    const it: LibItem = { ...item, id: newId(), name: `${item.name} (copy)`, parts: item.parts.map(p => ({ ...p, id: newId() })) };
    setLibrary([...library, it]); setCurrentId(it.id);
  }
  function remove() {
    if (!item) return;
    const used = usage(item.id);
    if (!window.confirm(used.length ? `"${item.name}" is used in ${used.length} room${used.length > 1 ? 's' : ''}. Delete it and remove it from those rooms?` : `Delete "${item.name}"?`)) return;
    const idx = library.findIndex(i => i.id === item.id);
    onDeleteItem(item.id);
    const rest = library.filter(i => i.id !== item.id);
    setCurrentId(rest[Math.min(idx, rest.length - 1)]?.id ?? null);
  }
  function exportFile() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: FILE_TYPE, version: 1, items: library }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'equipment-library.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(f: File) {
    try {
      const data = JSON.parse(await f.text());
      if (data?.type !== FILE_TYPE) throw new Error('wrong file');
      // Imported items always get new ids so they never overwrite what's already here.
      const items = normalizeLibrary(data.items).map(it => {
        let name = it.name, n = 2; while (library.some(x => x.name === name)) name = `${it.name} (${n++})`;
        return { ...it, id: newId(), name, parts: it.parts.map(p => ({ ...p, id: newId() })) };
      });
      setLibrary([...library, ...items]); if (items[0]) setCurrentId(items[0].id);
      setNote(`Imported ${items.length} item${items.length === 1 ? '' : 's'}.`);
    } catch { setNote('That file is not an HVAC Studio equipment library.'); }
  }

  const used = item ? usage(item.id) : [];
  return <>
    <div className="hvac-lib-actions">
      <span className="hvac-muted">Custom equipment built from parts. Add it to rooms from their Loads section.</span>
      <div className="hvac-reports-actions">
        <button className="hvac-btn" onClick={add}><Plus size={15} /> New item</button>
        <button className="hvac-btn" onClick={duplicate} disabled={!item}><Copy size={15} /> Duplicate</button>
        <button className="hvac-btn" onClick={remove} disabled={!item}><Trash2 size={15} /> Delete</button>
        <span className="hvac-sep" />
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        <button className="hvac-btn" title="Add items from a library file" onClick={() => importRef.current?.click()}><Upload size={15} /> Import</button>
        <button className="hvac-btn" title="Save this library as a file to reuse on other projects" onClick={exportFile} disabled={!library.length}><FileJson size={15} /> Export</button>
      </div>
    </div>
    {note && <div className="hvac-note hvac-reports-note">{note}</div>}
    <div className="hvac-lib-body">
      <nav className="hvac-lib-list" aria-label="Library items">
        {!library.length && <p className="hvac-muted">No equipment yet. Click <strong>New item</strong> to build one from its parts.</p>}
        {library.map(it => { const n = usage(it.id).reduce((t, u) => t + u.qty, 0);
          return <button key={it.id} className={`hvac-lib-item${it.id === currentId ? ' active' : ''}`} onClick={() => setCurrentId(it.id)}>
            <strong>{it.name}</strong><span>{fmt(Math.round(itemHeatW(it)))} W heat{n ? ` · ${fmt(n)} in rooms` : ''}</span></button>; })}
      </nav>
      <section className="hvac-lib-editor">
        {!item ? <p className="hvac-muted">Select or create an item.</p> : <>
          <div className="hvac-lib-head">
            <div className="hvac-field hvac-grow"><label>Name</label><input value={item.name} onChange={e => updateItem({ name: e.target.value })} /></div>
            {selectedRoom && <button className="hvac-btn primary" onClick={() => { onAddToRoom(item.id); setNote(`Added 1 × ${item.name} to ${selectedRoom}.`); }}><PackagePlus size={15} /> Add to {selectedRoom}</button>}
          </div>
          <div className="hvac-field"><label>Notes</label><input value={item.notes} placeholder="Source, model numbers, assumptions…" onChange={e => updateItem({ notes: e.target.value })} /></div>
          <table className="hvac-parts">
            <thead><tr><th className="txt">Part</th><th>Qty</th><th className="txt">Input</th><th className="txt">Power</th><th title="Share of input power released as heat in the room">Heat to space %</th><th>Input W</th><th>Heat W</th><th /></tr></thead>
            <tbody>{item.parts.map(p => <tr key={p.id}>
              <td className="txt"><input className="hvac-part-name" value={p.name} onChange={e => updatePart(p.id, { name: e.target.value })} /></td>
              <td><NumField value={p.qty} onChange={v => updatePart(p.id, { qty: v })} /></td>
              <td className="txt"><select value={p.input} onChange={e => updatePart(p.id, { input: e.target.value as PowerInput })}>{INPUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
              <td className="txt"><div className="hvac-power">
                {p.input === 'W' && <><NumField value={p.watts} onChange={v => updatePart(p.id, { watts: v })} /><span>W</span></>}
                {p.input === 'VA' && <><NumField value={p.volts} onChange={v => updatePart(p.id, { volts: v })} /><span>V ×</span>
                  <NumField value={p.amps} onChange={v => updatePart(p.id, { amps: v })} /><span>A</span>
                  <select value={p.phase} onChange={e => updatePart(p.id, { phase: Number(e.target.value) as 1 | 3 })}><option value={1}>1φ</option><option value={3}>3φ</option></select>
                  <span>PF</span><NumField value={p.pf} onChange={v => updatePart(p.id, { pf: Math.min(1, v) })} /></>}
                {p.input === 'HP' && <><NumField value={p.hp} onChange={v => updatePart(p.id, { hp: v })} /><span>HP · eff.</span>
                  <NumField value={p.eff} onChange={v => updatePart(p.id, { eff: Math.min(1, v) })} /></>}
              </div></td>
              <td><NumField value={p.heatPct} onChange={v => updatePart(p.id, { heatPct: Math.min(100, v) })} /></td>
              <td>{fmt(Math.round(p.qty * partInputW(p)))}</td>
              <td><strong>{fmt(Math.round(partHeatW(p)))}</strong></td>
              <td><button className="hvac-btn icon-only" title="Remove part" onClick={() => updateItem({ parts: item.parts.filter(x => x.id !== p.id) })}><Trash2 size={13} /></button></td>
            </tr>)}</tbody>
            <tfoot><tr><td className="txt" colSpan={5}>
              <button className="hvac-btn" onClick={() => updateItem({ parts: [...item.parts, newPart(`Part ${item.parts.length + 1}`)] })}><Plus size={13} /> Add part</button></td>
              <td>{fmt(Math.round(itemInputW(item)))}</td><td><strong>{fmt(Math.round(itemHeatW(item)))}</strong></td><td /></tr></tfoot>
          </table>
          <div className="hvac-lib-totals">
            <div><strong>{fmt(Math.round(itemInputW(item)))} W</strong><span>input power</span></div>
            <div><strong>{fmt(Math.round(itemHeatW(item)))} W</strong><span>heat to space</span></div>
            <div><strong>{fmt(Math.round(itemHeatW(item) * BTUH_PER_W))}</strong><span>BTU/h</span></div>
          </div>
          <p className="hvac-muted">Volts × amps uses V × A × PF (× √3 for 3-phase). Motor HP assumes the motor is in the room: HP × 746 ÷ efficiency. "Heat to space" covers diversity, duty cycle, or heat ducted/exhausted away.</p>
          <div className="hvac-field"><label>Used in</label>
            {used.length ? <div className="hvac-sel-list">{used.map((u, i) => <span key={i} className="hvac-sel-chip" style={{ cursor: 'default' }}>{u.room} × {fmt(u.qty)}</span>)}</div>
              : <div className="hvac-muted">Not used yet. Add it from a room's Loads section{selectedRoom ? ', or with the button above' : ''}.</div>}
          </div>
        </>}
      </section>
    </div>
  </>;
}
