// Mechanical Equipment section of the HVAC module: VAVs, fan coils, OA diffusers etc. drawn in rooms, checked against loads.
import { Plus, Trash2, ChevronRight, RotateCw, Copy } from 'lucide-react';
import { type Equip, type LoadUnit, LOAD_UNITS, EQUIP_TYPES, OA_DIFFUSER, BTUH_PER_W, fmt, newEquip, equipType, equipSize, equipSupply } from '../rooms';
import { NumField, Section, Meter } from '../ui';
import type { ModuleCtx } from './types';

export function MechanicalSections(ctx: ModuleCtx) {
  const { room: selected, m, altitudeFt, secOpen, toggleSec, updateRoom, pushHistory, cfm, btu, sc, selectedEquip, setSelectedEquip, hoverEquip, setHoverEquip, cardRefs, selectEquip, addEquipTo, removeEquip, updateEquipIn, cloneInto, styleOf, roundUp5 } = ctx;
  return <>
    <Section title="Mechanical Equipment" open={secOpen('hvac')} onToggle={()=>toggleSec('hvac')}
      aside={selected.equipment.length?<span className={m.coolingShort||m.heatingShort||m.oaShort?'hvac-bad-text':'hvac-ok-text'}>{selected.equipment.length} unit{selected.equipment.length>1?'s':''} · {m.coolingShort||m.heatingShort?'short':'OK'}</span>:undefined}>
      <div className="hvac-mech-summary">
        <Meter label="Cooling" have={m.coolCap} need={m.coolingLoad} short={m.coolingShort}/>
        <Meter label="Heating" have={m.heatCap} need={m.heatingLoad} short={m.heatingShort}/>
        <div className="hvac-row"><span>Supply air</span><strong>{cfm(m.supply)}{m.achSupply?` · ${fmt(m.achSupply)} ACH`:''}</strong></div>
        <div className="hvac-row"><span>Outdoor air</span><strong className={m.oaShort?'hvac-bad-text':undefined}>{fmt(m.oa)}{m.voz?` / ${fmt(m.voz)}`:''} cfm</strong></div>
        {m.coolingShort&&m.coolingLoad!==null&&<div className="hvac-bad-note">Cooling is short {btu(m.coolingLoad-m.coolCap)}: about {fmt(roundUp5((m.coolingLoad-m.coolCap)/(m.factor*Math.max(1,selected.coolSetpoint-m.designLat))))} more cfm at {fmt(m.designLat)} °F.</div>}
        {m.heatingShort&&m.heatingLoad!==null&&<div className="hvac-bad-note">Heating is short {btu(m.heatingLoad-m.heatCap)}.</div>}
      </div>
      <div className="hvac-quick-add">
        <button className="hvac-btn" title="Add a VAV box with reheat" onClick={()=>addEquipTo(selected,'VAV w/ Reheat')}><Plus size={13}/> VAV</button>
        <button className="hvac-btn" title="Add a fan coil unit" onClick={()=>addEquipTo(selected,'Fan Coil')}><Plus size={13}/> FCU</button>
        <button className="hvac-btn" title="Add a square diffuser delivering separate outdoor air" onClick={()=>addEquipTo(selected,OA_DIFFUSER)}><Plus size={13}/> OA</button>
        <select className="hvac-btn" value="" aria-label="Add other equipment" onChange={e=>{if(e.target.value)addEquipTo(selected,e.target.value);e.currentTarget.blur();}}>
          <option value="">More</option>{EQUIP_TYPES.filter(t=>!['VAV w/ Reheat','Fan Coil',OA_DIFFUSER].includes(t.type)).map(t=><option key={t.type}>{t.type}</option>)}</select>
      </div>
      {!selected.equipment.length&&<p className="hvac-muted">New units are sized for whatever load is left, placed in an open spot, and drawn on the plan. Drag them into position, or press {sc('equip')} and click in any room.</p>}
      {selected.equipment.map((e,k)=>{const res=m.equip[k],t=equipType(e.type),open=e.id===selectedEquip,oa=e.method==='oa';
        const up=(ch:Partial<Equip>)=>updateEquipIn(selected.id,e.id,ch);
        const toggle=()=>open?setSelectedEquip(null):selectEquip(selected.id,e.id);
        const headNum=e.method==='capacity'?btu(e.cools?e.coolCap:e.heatCap):cfm(equipSupply(e));
        return <div key={e.id} ref={el=>{if(el)cardRefs.current.set(e.id,el);else cardRefs.current.delete(e.id);}}
          className={`hvac-eqcard${open?' open':''}${e.id===hoverEquip?' hover':''}`} onMouseEnter={()=>setHoverEquip(e.id)} onMouseLeave={()=>setHoverEquip(null)}>
          <div className="hvac-eqcard-head" role="button" tabIndex={0} aria-expanded={open} onClick={toggle}
            onKeyDown={ev=>{if(ev.key==='Enter'){ev.preventDefault();toggle();}}}>
            <ChevronRight size={13} className="hvac-chev"/>
            <span className="hvac-swatch" style={{background:styleOf(e.type).color,borderRadius:oa?1:3}}/>
            <strong>{e.tag||t.prefix}</strong><span className="hvac-eqcard-type">{e.type}</span>
            <span className="hvac-eqcard-num">{headNum}</span>
            <button className="hvac-btn icon-only" title={`Remove ${e.tag||e.type}`} onClick={ev=>{ev.stopPropagation();removeEquip(selected.id,e.id);}}><Trash2 size={13}/></button>
          </div>
          {open&&<div className="hvac-eqcard-body">
            <div className="hvac-grid2">
              <div className="hvac-field"><label>Type</label><select value={e.type} onChange={ev=>{const d=newEquip(ev.target.value);
                up({...d,id:e.id,tag:e.tag,pos:e.pos,rot:e.rot,coolCfm:e.coolCfm,heatCfm:e.heatCfm,coolCap:e.coolCap,heatCap:e.heatCap});}}>
                {EQUIP_TYPES.map(x=><option key={x.type}>{x.type}</option>)}</select></div>
              <div className="hvac-field"><label>Tag</label><input value={e.tag} onChange={ev=>up({tag:ev.target.value})}/></div>
            </div>
            {oa?<>
              <div className="hvac-field"><label>Outdoor air (cfm)</label><NumField value={e.coolCfm} onChange={v=>up({coolCfm:v,heatCfm:v})}/></div>
              <div className="hvac-grid2">
                <div className="hvac-field"><label>Summer LAT (°F)</label><NumField value={e.coolLat} min={-100} onChange={v=>up({coolLat:v})}/></div>
                <div className="hvac-field"><label>Winter LAT (°F)</label><NumField value={e.heatLat} min={-100} onChange={v=>up({heatLat:v})}/></div>
              </div>
              <div className="hvac-muted hvac-eq-line">Cooling effect {btu(res.cool)} · heating effect {btu(res.heatToRoom)}{res.heatToRoom<0?' (adds to the heating load)':''}</div>
            </>:e.method==='air'?<>
              <div className="hvac-checks"><label><input type="checkbox" checked={e.cools} onChange={ev=>up({cools:ev.target.checked})}/> Cooling</label>
                <label><input type="checkbox" checked={e.heats} onChange={ev=>up({heats:ev.target.checked})}/> Heating</label></div>
              {e.cools&&<><div className="hvac-grid3">
                <div className="hvac-field"><label>Cooling cfm</label><NumField value={e.coolCfm} onChange={v=>up(e.type==='Fan Coil'?{coolCfm:v,heatCfm:v}:{coolCfm:v})}/></div>
                <div className="hvac-field"><label>LAT (°F)</label><NumField value={e.coolLat} min={-100} onChange={v=>up({coolLat:v})}/></div>
                <div className="hvac-field"><label>% OA</label><NumField value={e.oaPct} onChange={v=>up({oaPct:Math.min(100,v)})}/></div></div>
                <div className="hvac-muted hvac-eq-line">Sensible cooling {btu(res.cool)} · OA {cfm(res.oa)}</div></>}
              {e.heats&&<><div className="hvac-grid3">
                <div className="hvac-field"><label>Heating cfm</label><NumField value={e.heatCfm} onChange={v=>up(e.type==='Fan Coil'?{coolCfm:v,heatCfm:v}:{heatCfm:v})}/></div>
                <div className="hvac-field"><label>EAT (°F)</label><NumField value={e.heatEat} min={-100} onChange={v=>up({heatEat:v})}/></div>
                <div className="hvac-field"><label>LAT (°F)</label><NumField value={e.heatLat} min={-100} onChange={v=>up({heatLat:v})}/></div></div>
                {!e.cools&&<div className="hvac-field"><label>% OA</label><NumField value={e.oaPct} onChange={v=>up({oaPct:Math.min(100,v)})}/></div>}
                <div className="hvac-muted hvac-eq-line">To room {btu(res.heatToRoom)} · <strong>Coil {fmt(res.coil/1000)} MBH</strong> ({fmt(res.coil/BTUH_PER_W/1000)} kW)</div>
                {res.ezWarning&&<div className="hvac-warn-note">LAT is ≥15 °F above the space: with ceiling supply and return, Ez drops to 0.8 (ASHRAE 62.1 Table 6-4).</div>}</>}
              {e.cools&&e.heats&&e.heatCfm>0&&e.heatCfm<e.coolCfm&&e.oaPct>0&&<div className="hvac-muted hvac-eq-line">OA is counted at the heating (minimum) airflow.</div>}
            </>:<div className="hvac-grid2">
              <div className="hvac-checks" style={{gridColumn:'1 / -1'}}><label><input type="checkbox" checked={e.cools} onChange={ev=>up({cools:ev.target.checked})}/> Cooling</label>
                <label><input type="checkbox" checked={e.heats} onChange={ev=>up({heats:ev.target.checked})}/> Heating</label></div>
              {e.cools&&<div className="hvac-field"><label>Cooling capacity (BTU/h)</label><NumField value={e.coolCap} onChange={v=>up({coolCap:v})}/></div>}
              {e.heats&&<div className="hvac-field"><label>Heating capacity (BTU/h)</label><NumField value={e.heatCap} onChange={v=>up({heatCap:v})}/></div>}
            </div>}
            <div className="hvac-eqcard-size">
              <span className="hvac-muted">Symbol (ft)</span>
              <NumField value={equipSize(e).w} min={0.25} title="Width (ft)" onChange={v=>up({size:{...equipSize(e),w:v}})}/><span className="hvac-muted">×</span>
              <NumField value={equipSize(e).h} min={0.25} title="Depth (ft)" onChange={v=>up({size:{...equipSize(e),h:v}})}/>
              <button className="hvac-btn icon-only" title="Rotate 90°" onClick={()=>{pushHistory();up({rot:((e.rot??0)+90)%180});}}><RotateCw size={14}/></button>
            </div>
            <div className="hvac-eqcard-actions">
              <button className="hvac-btn" title="Duplicate (Ctrl/Cmd+D)" onClick={()=>cloneInto(e,selected)}><Copy size={13}/> Duplicate</button>
              <button className="hvac-btn hvac-btn-del" title="Delete (Del)" onClick={()=>removeEquip(selected.id,e.id)}><Trash2 size={13}/> Delete</button>
            </div>
          </div>}
        </div>;})}
      <div className="hvac-subhead">Design conditions</div>
      <div className="hvac-grid2">
        <div className="hvac-field"><label>Cooling setpoint (°F)</label><NumField value={selected.coolSetpoint} onChange={v=>updateRoom({coolSetpoint:v})}/></div>
        <div className="hvac-field"><label>Heating setpoint (°F)</label><NumField value={selected.heatSetpoint} onChange={v=>updateRoom({heatSetpoint:v})}/></div>
      </div>
      <div className="hvac-row"><span>Cooling load (from Loads)</span><strong>{btu(m.coolingLoad)}</strong></div>
      <div className="hvac-field"><label>Heating load</label><div className="hvac-inline">
        <NumField value={selected.heatingLoad.value} onChange={v=>updateRoom({heatingLoad:{...selected.heatingLoad,value:v}})}/>
        <select value={selected.heatingLoad.unit} onChange={e=>updateRoom({heatingLoad:{...selected.heatingLoad,unit:e.target.value as LoadUnit}})}>{LOAD_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
        {selected.heatingLoad.unit!=='BTU/h'&&<div className="hvac-muted hvac-load-eq">= {btu(m.heatingLoad)}</div>}</div>
      {m.coilTotal>0&&<div className="hvac-row"><span>Total heating coil</span><strong>{`${fmt(m.coilTotal/1000)} MBH · ${fmt(m.coilTotal/BTUH_PER_W/1000)} kW`}</strong></div>}
      <p className="hvac-muted">Q = {m.factor.toFixed(3)} × cfm × ΔT{altitudeFt>0?` (1.08 corrected for ${fmt(altitudeFt)} ft)`:''}. Coil = {m.factor.toFixed(3)} × heating cfm × (LAT − EAT).</p>
    </Section>
  </>;
}
