// ASHRAE 62.1 outdoor air and internal heat gains (Loads) sections of the HVAC module.
import { Plus, Trash2, Package } from 'lucide-react';
import { type OccUnit, type LoadUnit, OCC_UNITS, LOAD_UNITS, OA_DIFFUSER, BTUH_PER_W, fmt, newId, ashraeMatches, loadsMatch, itemHeatW } from '../rooms';
import { NumField, Section } from '../ui';
import type { ModuleCtx } from './types';

export function VentilationSections(ctx: ModuleCtx) {
  const { room: selected, m, tpl, env, openSettings, openLibrary, addLibToRoom, secOpen, toggleSec, updateRoom, tag, cfm, btu, addEquipTo, roundUp5 } = ctx;
  const net = m.area, occ = m.occupants, vbz = m.vbz, loadW = m.loadW, totalW = m.totalW;
  return <>
    <Section title="ASHRAE 62.1 Ventilation" open={secOpen('ashrae')} onToggle={()=>toggleSec('ashrae')} aside={<span className={m.oaShort?'hvac-bad-text':undefined}>{cfm(m.voz)}</span>}>
      {tag(!!tpl&&ashraeMatches(selected,tpl))}
      {tpl?.source?.vent&&ashraeMatches(selected,tpl)&&<div className="hvac-source">{tpl.source.vent}{tpl.source.verified?<span className="hvac-ok-text"> · verified</span>:<span className="hvac-unverified" title="This row hasn't been checked against the printed standard yet (src/reference)">unverified</span>}</div>}
      <div className="hvac-field"><label>Occupancy</label><div className="hvac-inline">
        <NumField value={selected.occupancy.value} onChange={v=>updateRoom({occupancy:{...selected.occupancy,value:v}})}/>
        <select value={selected.occupancy.unit} onChange={e=>updateRoom({occupancy:{...selected.occupancy,unit:e.target.value as OccUnit}})}>
          {OCC_UNITS.map(([u,l])=><option key={u} value={u}>{l}</option>)}</select></div></div>
      {selected.occupancy.unit!=='people'&&<div className="hvac-row"><span>Occupants (P<sub>z</sub>)</span><strong>{occ===null?'Calibrate first':fmt(occ)}</strong></div>}
      <div className="hvac-field"><label>People outdoor air rate, R<sub>p</sub> (cfm/person)</label><NumField value={selected.rp} onChange={v=>updateRoom({rp:v})}/></div>
      <div className="hvac-field"><label>Area outdoor air rate, R<sub>a</sub> (cfm/SF)</label><NumField value={selected.ra} onChange={v=>updateRoom({ra:v})}/></div>
      <div className="hvac-field"><label>Zone air distribution effectiveness, E<sub>z</sub></label><NumField value={selected.ez} min={0.01} onChange={v=>updateRoom({ez:v})}/></div>
      <div className="hvac-row"><span>V<sub>bz</sub> = R<sub>p</sub>·P<sub>z</sub> + R<sub>a</sub>·A<sub>z</sub></span><strong>{cfm(vbz)}</strong></div>
      <div className="hvac-row hvac-result"><span>Required OA, V<sub>oz</sub> = V<sub>bz</sub> / E<sub>z</sub></span><strong>{cfm(m.voz)}</strong></div>
      <div className="hvac-row hvac-result"><span>Provided OA (from equipment)</span><strong className={m.oaShort?'hvac-bad-text':undefined}>{cfm(m.oa)}</strong></div>
      {m.oaShort&&<div className="hvac-bad-note">{fmt(m.voz!-m.oa)} cfm below the required {cfm(m.voz)}.{' '}
        <button className="hvac-linkbtn" onClick={()=>addEquipTo(selected,OA_DIFFUSER)}>Add an OA diffuser for {fmt(roundUp5(m.voz!-m.oa))} cfm</button></div>}
      {!selected.equipment.length&&<p className="hvac-muted">Outdoor air comes from the room's equipment: each unit's airflow × its % OA, plus OA diffusers.</p>}
    </Section>
    <Section title="Loads" open={secOpen('loads')} onToggle={()=>toggleSec('loads')} aside={totalW===null?undefined:`${fmt(totalW*BTUH_PER_W)} BTU/h`}>
      {tag(!!tpl&&loadsMatch(selected,tpl))}
      {selected.loads.map((l,k)=>l.libId?(()=>{const it=env.library.find(i=>i.id===l.libId);
        return <div className="hvac-load hvac-load-lib" key={l.id}>
          <div className="hvac-inline"><Package size={13} className="hvac-lib-icon"/>
            <button className="hvac-linkbtn hvac-lib-name" title="Edit in the Equipment Library" onClick={()=>openLibrary(l.libId)}>{it?.name??l.name}</button>
            <button className="hvac-btn icon-only" title="Remove from this room" onClick={()=>updateRoom({loads:selected.loads.filter((_,j)=>j!==k)})}><Trash2 size={13}/></button></div>
          <div className="hvac-inline hvac-lib-qty"><span className="hvac-muted">Qty</span>
            <NumField value={l.qty??1} onChange={v=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,qty:v}:x)})}/>
            <span className="hvac-muted">× {it?fmt(Math.round(itemHeatW(it))):'—'} W</span><strong>= {fmt(Math.round(loadW[k]??0))} W</strong></div>
          {!it&&<div className="hvac-bad-note">This item is no longer in the Equipment Library.</div>}
        </div>;})():<div className="hvac-load" key={l.id}>
        <input className="hvac-load-name" value={l.name} aria-label="Load name" onChange={e=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,name:e.target.value}:x)})}/>
        <div className="hvac-inline">
          <NumField value={l.value} onChange={v=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,value:v}:x)})}/>
          <select value={l.unit} onChange={e=>updateRoom({loads:selected.loads.map((x,j)=>j===k?{...x,unit:e.target.value as LoadUnit}:x)})}>{LOAD_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select>
          <button className="hvac-btn icon-only" title="Remove load" onClick={()=>updateRoom({loads:selected.loads.filter((_,j)=>j!==k)})}><Trash2 size={13}/></button>
        </div>
        {loadW[k]!==null&&l.unit!=='W'&&<div className="hvac-muted hvac-load-eq">= {fmt(loadW[k]!)} W</div>}
      </div>)}
      <div className="hvac-load-add">
        <button className="hvac-btn" onClick={()=>updateRoom({loads:[...selected.loads,{id:newId(),name:'Load',value:0,unit:'W'}]})}><Plus size={14}/> Add load</button>
        {env.library.length?<select className="hvac-btn" value="" aria-label="Add equipment from the library" onChange={e=>{const v=e.target.value;e.currentTarget.blur();if(v==='__open')openLibrary();else if(v)addLibToRoom(selected,v);}}>
            <option value="">+ From library…</option>
            {env.library.map(it=><option key={it.id} value={it.id}>{it.name} ({fmt(Math.round(itemHeatW(it)))} W)</option>)}
            <option value="__open">Open Equipment Library…</option></select>
          :<button className="hvac-btn" title="Build custom equipment from its parts" onClick={()=>openLibrary()}><Package size={14}/> Equipment library</button>}
      </div>
      <div className="hvac-row"><span>Internal loads</span><strong>{totalW===null?'Calibrate first':`${fmt(totalW)} W · ${btu(totalW*BTUH_PER_W)}`}</strong></div>
      <div className="hvac-row"><span>Load density</span><strong>{totalW===null||!net?'—':`${fmt(totalW/net)} W/SF`}</strong></div>
      <div className="hvac-row"><span>People ({occ===null?'—':fmt(occ)} × {fmt(env.peopleSensible)} BTU/h)</span><strong>{btu(m.peopleBtuh)}</strong></div>
      <div className="hvac-muted hvac-load-eq" style={{marginTop:-4}}>Heat per person is a project setting. <button className="hvac-linkbtn" style={{padding:0,fontSize:11}} onClick={()=>openSettings('set-project')}>Change</button></div>
      <div className="hvac-row hvac-result"><span>Sensible cooling load</span><strong>{btu(m.coolingLoad)}</strong></div>
    </Section>
  </>;
}
