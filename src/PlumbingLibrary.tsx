// Plumbing fixtures tab of the Libraries window: build the project's short list of fixture types
// from the code catalog, then inspect and (if needed) override each one's units, trap size and symbol.
import { useState } from 'react';
import { Plus, Trash2, Search, RotateCcw, PackagePlus } from 'lucide-react';
import { type Occupancy, fixtureCatalog, wsfuTable, dfuTable, sourceLabel } from './reference';
import { type FixtureType, OCCUPANCIES, refValues, newFixtureType, differsFromRef, resetToRef } from './plumbing';
import { NumField } from './ui';
import { SYMBOLS, SymbolPreview } from './symbols';
import { fmtFu } from './rooms';

type Props = {
  types: FixtureType[];
  setTypes: (next: FixtureType[]) => void;
  usage: (typeId: string) => number;             // placed count across the project
  onDeleteType: (id: string) => void;            // also removes placed fixtures (with undo)
  selectedRoom: string | null;
  onAddToRoom: (typeId: string) => void;
};
const u = (v: number | null) => v === null ? '—' : fmtFu(v);

export default function PlumbingLibrary({ types, setTypes, usage, onDeleteType, selectedRoom, onAddToRoom }: Props) {
  const [currentId, setCurrentId] = useState<string | null>(types[0]?.id ?? null);
  const [picking, setPicking] = useState(types.length === 0);
  const [occ, setOcc] = useState<Occupancy>('public');
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const t = types.find(x => x.id === currentId) ?? null;
  const update = (ch: Partial<FixtureType>) => t && setTypes(types.map(x => x.id === t.id ? { ...x, ...ch } : x));

  function pick(catalogId: string) {
    const nt = newFixtureType(catalogId, occ, types); if (!nt) return;
    // Stay on the catalog so several fixtures can be added in a row; click one in the list to check its values.
    setTypes([...types, nt]); setCurrentId(nt.id); setNote(`Added ${nt.tag} (${nt.name}). Keep adding, or click a fixture on the left to check and edit its values.`);
  }
  function remove() {
    if (!t) return;
    const n = usage(t.id);
    if (!window.confirm(n ? `${t.tag} is placed ${n} time${n > 1 ? 's' : ''}. Delete it and remove those fixtures from the plan?` : `Delete ${t.tag}?`)) return;
    const idx = types.findIndex(x => x.id === t.id); onDeleteType(t.id);
    const rest = types.filter(x => x.id !== t.id); setCurrentId(rest[Math.min(idx, rest.length - 1)]?.id ?? null);
  }
  const ref = t ? refValues(t.catalogId, t.occ) : null, diffs = t ? differsFromRef(t) : [];
  const hint = (field: string, v: number | string | null) => <div className={`hvac-ref-hint${diffs.includes(field) ? ' differs' : ''}`}>table: {typeof v === 'number' ? u(v) : v || '—'}</div>;
  const rows = fixtureCatalog.rows.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  return <>
    <div className="hvac-lib-actions">
      <span className="hvac-muted">The fixtures this project uses. Pick them from the code tables, check their units, then place them from the Plumbing module.</span>
      <div className="hvac-reports-actions">
        <button className={`hvac-btn${picking ? ' active' : ''}`} onClick={() => setPicking(p => !p)}><Plus size={15} /> Add from catalog</button>
        <button className="hvac-btn" onClick={remove} disabled={!t || picking}><Trash2 size={15} /> Delete</button>
      </div>
    </div>
    {note && <div className="hvac-note hvac-reports-note">{note}</div>}
    <div className="hvac-lib-body">
      <nav className="hvac-lib-list" aria-label="Project fixtures">
        {!types.length && <p className="hvac-muted">No fixtures picked yet. Choose the few this project needs from the catalog.</p>}
        {types.map(x => { const d = differsFromRef(x), n = usage(x.id);
          return <button key={x.id} className={`hvac-lib-item hvac-fix-item${x.id === currentId && !picking ? ' active' : ''}`} onClick={() => { setCurrentId(x.id); setPicking(false); }}>
            <SymbolPreview symbol={x.symbol} w={x.size.w} h={x.size.h} px={30} />
            <span className="hvac-fix-item-text"><strong>{x.tag}</strong> {x.name}
              <span>{OCCUPANCIES.find(o => o[0] === x.occ)?.[1]} · {u(x.wsfu)} WSFU · {u(x.dfu)} DFU{n ? ` · ${n} placed` : ''}{d.length ? ' · edited' : ''}</span></span>
          </button>; })}
      </nav>
      <section className="hvac-lib-editor">
        {picking ? <>
          <div className="hvac-lib-head">
            <div className="hvac-field hvac-grow"><label>Catalog: {wsfuTable.meta.standard} {wsfuTable.meta.edition}</label>
              <div className="hvac-search"><Search size={14} /><input autoFocus value={q} placeholder="Search fixtures…" onChange={e => setQ(e.target.value)} /></div></div>
            <div className="hvac-field"><label>Occupancy</label><select value={occ} onChange={e => setOcc(e.target.value as Occupancy)}>{OCCUPANCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          <table className="hvac-parts hvac-catalog">
            <thead><tr><th /><th className="txt">Fixture</th><th>Cold</th><th>Hot</th><th>Total WSFU</th><th>DFU</th><th>Trap</th><th className="txt">Source</th><th /></tr></thead>
            <tbody>{rows.map(c => { const v = refValues(c.id, occ)!, na = (v.wsfu === null || v.wsfu === 0) && (v.dfu === null || v.dfu === 0) && v.wsfuSource !== null;
              return <tr key={c.id} className={na ? 'na' : undefined}>
                <td><SymbolPreview symbol={c.symbol} w={c.size.w} h={c.size.h} px={28} /></td>
                <td className="txt">{c.name}{(() => { const have = types.filter(x => x.catalogId === c.id); return have.length ? <span className="hvac-in-project">{have.map(x => x.tag).join(', ')}</span> : null; })()}</td><td>{u(v.cold)}</td><td>{u(v.hot)}</td><td><strong>{u(v.wsfu)}</strong></td><td><strong>{u(v.dfu)}</strong></td><td>{v.trap ? `${v.trap}"` : '—'}</td>
                <td className="txt">{v.verified ? <span className="hvac-ok-text">verified</span> : <span className="hvac-unverified">unverified</span>}</td>
                <td><button className="hvac-btn" disabled={na} title={na ? `No ${occ} value in the tables` : types.some(x => x.catalogId === c.id) ? 'Already in this project: add another (e.g. a different occupancy)' : 'Add to this project'} onClick={() => pick(c.id)}><Plus size={13} /> Add</button></td>
              </tr>; })}</tbody>
          </table>
          <p className="hvac-muted">Cold and hot are each 3/4 of the total for fixtures with both supplies (Table 610.3 footnote). Sources: {sourceLabel(wsfuTable.meta)} and {sourceLabel(dfuTable.meta)}. Values come from <code>src/reference/</code>.</p>
        </> : !t ? <p className="hvac-muted">Select a fixture, or add one from the catalog.</p> : <>
          <div className="hvac-lib-head">
            <div className="hvac-fix-preview"><SymbolPreview symbol={t.symbol} w={t.size.w} h={t.size.h} px={72} /></div>
            <div className="hvac-field" style={{ width: 110 }}><label>Tag</label><input value={t.tag} onChange={e => update({ tag: e.target.value })} /></div>
            <div className="hvac-field hvac-grow"><label>Name</label><input value={t.name} onChange={e => update({ name: e.target.value })} /></div>
            <div className="hvac-field"><label>Occupancy</label><select value={t.occ} onChange={e => { const o = e.target.value as Occupancy; setTypes(types.map(x => x.id === t.id ? resetToRef({ ...x, occ: o }) : x)); setNote(`${t.tag}: values reset to the ${o} column of the tables.`); }}>
              {OCCUPANCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            {selectedRoom && <button className="hvac-btn primary" onClick={() => { onAddToRoom(t.id); setNote(`Placed one ${t.tag} in ${selectedRoom}. Drag it into position on the plan.`); }}><PackagePlus size={15} /> Add to {selectedRoom}</button>}
          </div>
          <div className="hvac-fix-grid">
            <div className="hvac-field"><label>Cold WSFU</label><NumField value={t.cold} onChange={v => update({ cold: v })} />{hint('cold', ref?.cold ?? null)}</div>
            <div className="hvac-field"><label>Hot WSFU</label><NumField value={t.hot} onChange={v => update({ hot: v })} />{hint('hot', ref?.hot ?? null)}</div>
            <div className="hvac-field"><label>Total WSFU</label><NumField value={t.wsfu} onChange={v => update({ wsfu: v })} />{hint('WSFU', ref?.wsfu ?? null)}</div>
            <div className="hvac-field"><label>DFU</label><NumField value={t.dfu} onChange={v => update({ dfu: v })} />{hint('DFU', ref?.dfu ?? null)}</div>
            <div className="hvac-field"><label>Trap (in)</label><input value={t.trap} onChange={e => update({ trap: e.target.value })} />{hint('trap', ref?.trap ?? '')}</div>
            <div className="hvac-field"><label>Min. branch (in)</label><input value={t.branch} onChange={e => update({ branch: e.target.value })} /></div>
          </div>
          {diffs.length > 0 && <div className="hvac-warn-note">Edited from the table: {diffs.join(', ')}.{' '}
            <button className="hvac-linkbtn" style={{ padding: 0 }} onClick={() => { setTypes(types.map(x => x.id === t.id ? resetToRef(x) : x)); setNote(`${t.tag}: reset to table values.`); }}><RotateCcw size={11} /> Reset to table values</button></div>}
          <div className="hvac-source" style={{ marginTop: 8 }}>
            {ref?.wsfuSource && <div>WSFU: {ref.wsfuSource}</div>}{ref?.dfuSource && <div>DFU: {ref.dfuSource}</div>}
            {ref && (ref.verified ? <span className="hvac-ok-text">verified</span> : <span className="hvac-unverified" style={{ marginLeft: 0 }}>unverified</span>)}
          </div>
          <div className="hvac-fix-grid" style={{ marginTop: 10, gridTemplateColumns: '2fr 1fr 1fr', maxWidth: 740 }}>
            <div className="hvac-field"><label>Plan symbol</label><select value={t.symbol} onChange={e => update({ symbol: e.target.value })}>{SYMBOLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="hvac-field"><label>Width (ft)</label><NumField value={t.size.w} min={0.25} onChange={v => update({ size: { ...t.size, w: v } })} /></div>
            <div className="hvac-field"><label>Depth (ft)</label><NumField value={t.size.h} min={0.25} onChange={v => update({ size: { ...t.size, h: v } })} /></div>
          </div>
          <div className="hvac-field"><label>Note</label><input value={t.note} placeholder="Why a value was changed, model number…" onChange={e => update({ note: e.target.value })} /></div>
          <p className="hvac-muted">Placed {usage(t.id)} time{usage(t.id) === 1 ? '' : 's'} in this project.</p>
        </>}
      </section>
    </div>
  </>;
}
