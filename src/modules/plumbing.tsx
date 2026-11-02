// Plumbing module: physical fixtures placed in rooms, totalled as water supply (WSFU) and drainage (DFU)
// fixture units. Takes nothing from HVAC. Fixture types come from the project's short list (Libraries → Plumbing).
import { Plus, Trash2, Droplets } from 'lucide-react';
import { fmtFu } from '../rooms';
import { Section } from '../ui';
import { SymbolPreview } from '../symbols';
import { wsfuTable, dfuTable, sourceLabel } from '../reference';
import type { ModuleCtx, ModuleDef } from './types';

const u = (v: number) => fmtFu(v);

function PlumbingSections(ctx: ModuleCtx) {
  const { room, m, secOpen, toggleSec, sc, fixtureTypes, selectedFix, selectFixture, addFixtureTo, removeFixture, openLibraries, openSchedule, startPlacing } = ctx;
  const p = m.plumbing, fixtures = room.fixtures ?? [];
  const typeOf = (id: string) => fixtureTypes.find(t => t.id === id);
  return <Section title="Plumbing Fixtures" open={secOpen('plumb')} onToggle={() => toggleSec('plumb')}
    aside={p.count ? <span>{p.count} fixture{p.count > 1 ? 's' : ''} · {u(p.wsfu)} WSFU</span> : undefined}>
    <div className="hvac-area-card four">
      <div><strong>{u(p.cold)}</strong><span>Cold WSFU</span></div>
      <div><strong>{u(p.hot)}</strong><span>Hot WSFU</span></div>
      <div><strong>{u(p.wsfu)}</strong><span>Total WSFU</span></div>
      <div><strong>{u(p.dfu)}</strong><span>DFU</span></div>
    </div>
    {!fixtureTypes.length ? <div className="hvac-note" style={{ marginTop: 8 }}>
        No fixtures picked for this project yet. Choose the few you need from the code tables first.
        <button className="hvac-btn primary" style={{ marginTop: 8, width: '100%' }} onClick={openLibraries}><Droplets size={14} /> Pick fixtures…</button>
      </div>
      : <>
        <div className="hvac-quick-add fix">
          {fixtureTypes.map(t => <button key={t.id} className="hvac-btn" title={`Add one ${t.name} to ${room.name}`} onClick={() => addFixtureTo(room, t.id)}><Plus size={13} /> {t.tag}</button>)}
        </div>
        <div className="hvac-inline" style={{ gap: 14 }}>
          <button className="hvac-linkbtn" style={{ padding: '0 0 6px' }} onClick={openLibraries}>Edit project fixtures…</button>
          <button className="hvac-linkbtn" style={{ padding: '0 0 6px' }} onClick={openSchedule}>Fixture schedule…</button>
        </div>
      </>}
    {fixtures.length > 0 && <div className="hvac-fix-list">
      {fixtures.map(f => { const t = typeOf(f.typeId); if (!t) return null;
        return <div key={f.id} className={`hvac-fix-row${f.id === selectedFix ? ' active' : ''}`} role="button" tabIndex={0}
          onClick={() => selectFixture(room.id, f.id)} onKeyDown={e => { if (e.key === 'Enter') selectFixture(room.id, f.id); }}>
          <SymbolPreview symbol={t.symbol} w={t.size.w} h={t.size.h} px={24} />
          <strong>{t.tag}</strong><span className="hvac-fix-row-name">{t.name}</span>
          <span className="hvac-fix-row-num">{u(t.wsfu)} / {u(t.dfu)}</span>
          <button className="hvac-btn icon-only" title={`Remove ${t.tag}`} onClick={e => { e.stopPropagation(); removeFixture(room.id, f.id); }}><Trash2 size={13} /></button>
        </div>; })}
      <div className="hvac-muted" style={{ textAlign: 'right', fontSize: 11 }}>WSFU / DFU each</div>
    </div>}
    {fixtureTypes.length > 0 && !fixtures.length && <p className="hvac-muted">No fixtures in this room.</p>}
    {fixtureTypes.length > 0 && <button className="hvac-btn" style={{ width: '100%', marginTop: 6 }} onClick={() => startPlacing(fixtureTypes[0].id)}><Droplets size={14} /> Place fixtures ({sc('fixture')}) · R rotates</button>}
    <p className="hvac-source" style={{ marginTop: 8 }}>{sourceLabel(wsfuTable.meta)} · {sourceLabel(dfuTable.meta)}. Unverified values are flagged in Libraries → Plumbing.</p>
  </Section>;
}

export const plumbingModule: ModuleDef = {
  id: 'plumb', name: 'Plumbing', short: 'Plumbing', report: 'plumbing',
  Sections: PlumbingSections,
  summary: (_r, m) => ({ text: m.plumbing.count ? `${m.plumbing.count} fixtures · ${u(m.plumbing.wsfu)} WSFU · ${u(m.plumbing.dfu)} DFU` : 'No fixtures', bad: false }),
  labelLine: (_r, m) => m.plumbing.count ? { text: `${u(m.plumbing.wsfu)} WSFU · ${u(m.plumbing.dfu)} DFU`, bad: false } : null,
};
