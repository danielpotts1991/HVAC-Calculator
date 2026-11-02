import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Upload, MousePointer2, PenTool, Ruler, Trash2, Undo2, ZoomIn, ZoomOut, Download, FileText, Maximize, Save, FolderOpen, SaveAll, Scissors, Magnet, Settings, Eye, X, ChevronRight, ClipboardList, Check, AirVent, RefreshCw, Layers as LayersIcon, LayoutList, Package, Droplets } from 'lucide-react';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
import { type Point, type Room, type Equip, EQUIP_TYPES, OA_DIFFUSER, newEquip, equipType, equipSize, equipSupply, DEFAULT_LABEL_SIZE,
  areaPx, cutoutsOf, netAreaPx, fmt, fmtFu, tidy, newId, normalizeRoom, metrics, sensibleFactor, type Env, type LibItem, normalizeLibrary, roomHasIssue, BUILTIN_TEMPLATES, applyTemplate, templateFromRoom,
  COLUMNS } from './rooms';
import Reports from './Reports';
import RoomTable from './RoomTable';
import EquipmentLibrary from './EquipmentLibrary';
import PlumbingLibrary from './PlumbingLibrary';
import Libraries, { type LibTab } from './Libraries';
import { REFERENCE_FILES, referenceIssues, verifiedCount } from './reference';
import { type FixtureType, type PlacedFixture, normalizeFixtureTypes } from './plumbing';
import { FixtureSymbol, SymbolPreview } from './symbols';
const FIXTURE_STYLE='Plumbing fixtures'; // key in settings.equipStyle
import { dist, scales, scaleFeetPerPoint, snapDirection, closeSnapped, isSimplePolygon, pointInRing, ringInside, ringsOverlap, edgeNormal, offsetEdge, offsetEdgeBy, inRect, ringTouchesRect, ringPath, fmtFeet } from './geometry';
import { labelPoint, labelObstacle, equipRadiusFt, equipObstacles, freeSpot, placeMissingEquipment, translateRoom } from './plan';
import { type Tool, type Action, type AppSettings, ACTIONS, DEFAULT_SHORTCUTS, RESERVED_KEYS, keyLabel, DEFAULT_EQUIP_OPACITY, SETTINGS_KEY, loadSettings, isTyping } from './settings';
import { NumField, Section, SidePanel, IconBtn } from './ui';
import { MODULES, moduleById, type ModuleCtx, type ModuleId } from './modules';

type EdgeSel = { ring: number; index: number }; // ring -1 = room outline, k = cutout k
const bytesToBase64=(bytes:Uint8Array)=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
const base64ToBytes=(b64:string)=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
type ProjectFile={version:1;pdfName:string;pdfBase64:string|null;pageNumber:number;scale:string;customFeetPerPoint:number|null;altitudeFt?:number;peopleSensible?:number;library?:LibItem[];fixtureTypes?:FixtureType[];rooms:Room[]};
type WritableHandle={name:string;createWritable:()=>Promise<{write:(data:string)=>Promise<void>;close:()=>Promise<void>}>};
type FilePickerWindow=Window & {showSaveFilePicker?:(opts:object)=>Promise<WritableHandle>;showOpenFilePicker?:(opts:object)=>Promise<Array<{getFile:()=>Promise<File>;name:string}>>};
export default function App(){
  const [pdf,setPdf]=useState<pdfjsLib.PDFDocumentProxy|null>(null);
  const [pdfName,setPdfName]=useState('No drawing loaded');
  const pdfBytesRef=useRef<Uint8Array<ArrayBuffer>|null>(null);
  const projectHandleRef=useRef<WritableHandle|null>(null);
  const [projectName,setProjectName]=useState('Untitled.hvac.json');
  const [dirty,setDirty]=useState(false);
  const lastSnapshotRef=useRef('');
  const initializedRef=useRef(false);
  const [pageNumber,setPageNumber]=useState(1);
  const [pageSize,setPageSize]=useState({width:900,height:650});
  const [zoom,setZoom]=useState(1);
  const [tool,setTool]=useState<Tool>('select');
  const [orthogonal,setOrthogonal]=useState(true);
  const [scale,setScale]=useState('1/8');
  const [customFeetPerPoint,setCustomFeetPerPoint]=useState<number|null>(null);
  // Project-wide values (saved in the project file, edited in Settings > Project).
  const [altitudeFt,setAltitudeFt]=useState(0);         // site altitude: corrects the 1.08 sensible factor
  const [peopleSensible,setPeopleSensible]=useState(250); // BTU/h per person
  const [library,setLibrary]=useState<LibItem[]>([]);     // heat-generating equipment library (custom equipment with parts)
  const [fixtureTypes,setFixtureTypes]=useState<FixtureType[]>([]); // the project's plumbing fixture short list
  const [rooms,setRooms]=useState<Room[]>([]);
  const [draft,setDraft]=useState<Point[]>([]);
  const draftRef=useRef<Point[]>([]);
  useEffect(()=>{draftRef.current=draft;},[draft]);
  const [hover,setHover]=useState<Point|null>(null);
  const hoverRef=useRef<Point|null>(null); // latest cursor position, without waiting for a render (used by paste)
  const [rectStart,setRectStart]=useState<Point|null>(null);
  const [rectEnd,setRectEnd]=useState<Point|null>(null);
  const [calPoints,setCalPoints]=useState<Point[]>([]);
  const [selectedId,setSelectedIdRaw]=useState<string|null>(null);
  const [selectedEdge,setSelectedEdge]=useState<EdgeSel|null>(null);
  // Selecting a room (or nothing) always clears any edge selection.
  const [labelSel,setLabelSel]=useState(false); // the selected room's label is selected (drag / resize / arrows)
  // Selected equipment symbol (always inside the selected room).
  const [selectedEquip,setSelectedEquip]=useState<string|null>(null);
  const [hoverEquip,setHoverEquip]=useState<string|null>(null);
  const [placeType,setPlaceType]=useState(EQUIP_TYPES[0].type);
  const equipDragRef=useRef<{roomId:string;id:string;start:Point;startPos:Point;pushed:boolean}|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null|undefined>(undefined); // while dragging: room id under the symbol, null = outside any room
  const clipboardRef=useRef<Equip|null>(null);
  const cardRefs=useRef(new Map<string,HTMLDivElement>());
  // Hold space to pan with the left mouse button.
  const [spaceHeld,setSpaceHeld]=useState(false);const spaceRef=useRef(false);
  const [panning,setPanning]=useState(false);
  // Multi-selection of rooms; selectedId is the primary (last clicked) one shown in the properties panel.
  const [selIds,setSelIds]=useState<string[]>([]);
  const [marquee,setMarquee]=useState<{a:Point;b:Point}|null>(null);
  const marqueeRef=useRef<{start:Point;add:boolean}|null>(null);
  const moveDragRef=useRef<{ids:string[];start:Point;orig:Map<string,Room>;pushed:boolean;dx:number;dy:number;clicked:string;collapse:boolean}|null>(null);
  // Plumbing fixtures: selection, placement type/rotation, drag, clipboard.
  const [selectedFix,setSelectedFix]=useState<string|null>(null);
  const [placeFixType,setPlaceFixType]=useState('');
  const [placeRot,setPlaceRot]=useState(0); // rotation of the symbol being placed (R)
  const fixDragRef=useRef<{roomId:string;id:string;start:Point;startPos:Point;pushed:boolean}|null>(null);
  const fixClipRef=useRef<PlacedFixture|null>(null);
  const setSelection=(ids:string[],primary:string|null)=>{setSelIds(ids);setSelectedIdRaw(primary);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);setSelectedFix(null);};
  const setSelectedId=(id:string|null)=>setSelection(id?[id]:[],id);
  // Label drag / resize in progress. history is pushed once, on the first real movement.
  const edgeDragRef=useRef<{roomId:string;ring:number;index:number;startRing:Point[];start:Point;normal:Point;pushed:boolean;dist:number}|null>(null);
  const labelDragRef=useRef<{mode:'move'|'size';id:string;start:Point;startPos:Point;startSize:number;center:Point;pushed:boolean}|null>(null);
  const labelRefs=useRef(new Map<string,SVGTextElement>());
  const [labelBox,setLabelBox]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  // Room-level undo history (Ctrl/Cmd+Z). Each entry is the rooms list before a change.
  const historyRef=useRef<Room[][]>([]);
  const pushHistory=()=>{historyRef.current.push(rooms);if(historyRef.current.length>200)historyRef.current.shift();};
  const [message,setMessage]=useState('Import a PDF to begin.');
  // Sharp rendering: the base canvas holds the whole page at screen resolution (zoom 1);
  // the detail canvas re-renders just the visible part at the current zoom once zooming/panning settles.
  const pageRef=useRef<pdfjsLib.PDFPageProxy|null>(null);
  const detailRef=useRef<HTMLCanvasElement>(null);
  const detailTaskRef=useRef<{cancel:()=>void}|null>(null);
  const detailTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const movingTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const replaceRef=useRef<HTMLInputElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null),svgRef=useRef<SVGSVGElement>(null),fileRef=useRef<HTMLInputElement>(null),scrollRef=useRef<HTMLElement>(null);
  const panRef=useRef<{x:number;y:number;offsetX:number;offsetY:number}|null>(null);
  const offsetRef=useRef({x:20,y:20});
  const zoomLabelTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const zoomRef=useRef(1);
  const rectRef=useRef<Point|null>(null);
  // First press of the Draw/Cutout tool: becomes a rectangle if dragged, or the first polygon corner if released in place.
  const pressRef=useRef<{p:Point;x:number;y:number;dragging:boolean}|null>(null);
  const [settings,setSettings]=useState<AppSettings>(loadSettings);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [reportsOpen,setReportsOpen]=useState(false);
  const [reportsInitial,setReportsInitial]=useState<string|undefined>(undefined);
  const [tplChoice,setTplChoice]=useState('');
  const [capturing,setCapturing]=useState<Action|null>(null);
  const [captureNote,setCaptureNote]=useState('');
  useEffect(()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{/* storage unavailable */}},[settings]);
  const sc=(a:Action)=>keyLabel(settings.shortcuts[a]);
  const secOpen=(k:string)=>settings.sections[k]??true;
  const allTemplates=[...BUILTIN_TEMPLATES,...settings.roomTemplates];
  const findTemplate=(id?:string|null)=>id?allTemplates.find(t=>t.id===id):undefined;
  const templateName=(id?:string|null)=>findTemplate(id)?.name??'Custom';
  const env:Env={altitudeFt,peopleSensible,library,fixtureTypes};
  const mOf=(r:Room)=>metrics(r,feetPerPoint,env);
  const activeModule=moduleById(settings.activeModule);
  const equipLive=settings.activeModule==='hvac'; // equipment symbols are editable only in the HVAC module
  const fixLive=settings.activeModule==='plumb';  // plumbing fixtures only in the Plumbing module
  const [layersOpen,setLayersOpen]=useState(false);
  // Pan (keeping zoom) so a room sits in the middle of the view.
  function centerOn(room:Room){
    const v=scrollRef.current;if(!v)return;
    const xs=room.points.map(p=>p.x),ys=room.points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    offsetRef.current={x:v.clientWidth/2-cx*zoomRef.current,y:v.clientHeight/2-cy*zoomRef.current};updateViewport();
  }
  function tableRowClick(id:string,additive:boolean){
    setTool('select');
    if(additive){const ids=selIds.includes(id)?selIds.filter(x=>x!==id):[...selIds,id];setSelection(ids,ids.includes(id)?id:ids[ids.length-1]??null);return;}
    setSelectedId(id);const r=rooms.find(x=>x.id===id);if(r)centerOn(r);
  }
  // The drawing area changes size when the table opens or is resized: re-render the sharp layer.
  useEffect(()=>{scheduleDetail();},[settings.table.open,settings.table.height]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Layers menu closes on any click outside it (or Esc).
  useEffect(()=>{
    if(!layersOpen)return;
    const down=(e:PointerEvent)=>{if(!(e.target instanceof Element&&e.target.closest('.hvac-layers-wrap')))setLayersOpen(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setLayersOpen(false);};
    window.addEventListener('pointerdown',down,true);window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('pointerdown',down,true);window.removeEventListener('keydown',key);};
  },[layersOpen]);
  function openSettings(section?:string){
    if(section)setSettings(st=>({...st,sections:{...st.sections,[section]:true}}));
    setSettingsOpen(true);setCaptureNote('');
  }
  const [libraryOpen,setLibraryOpen]=useState<{tab:LibTab;item:string|null}|false>(false);
  function openLibrary(itemId?:string){setLibraryOpen({tab:'heat',item:itemId??null});}   // heat-generating equipment
  function openLibraries(tab:LibTab){setLibraryOpen({tab,item:null});}
  // Library edits: keep room load lines named after their item.
  function updateLibrary(next:LibItem[]){
    const names=new Map(next.map(i=>[i.id,i.name]));
    setLibrary(next);
    setRooms(v=>v.map(r=>r.loads.some(l=>l.libId&&names.has(l.libId)&&names.get(l.libId)!==l.name)
      ?{...r,loads:r.loads.map(l=>l.libId&&names.has(l.libId)?{...l,name:names.get(l.libId)!}:l)}:r));
  }
  const libUsage=(id:string)=>rooms.flatMap(r=>{const q=r.loads.filter(l=>l.libId===id).reduce((t,l)=>t+(l.qty??1),0);return q?[{room:r.name,qty:q}]:[];});
  function addLibToRoom(room:Room,id:string){
    const it=library.find(i=>i.id===id);if(!it)return;
    pushHistory();
    setRooms(v=>v.map(r=>{if(r.id!==room.id)return r;
      const has=r.loads.find(l=>l.libId===id);
      return {...r,loads:has?r.loads.map(l=>l===has?{...l,qty:(l.qty??1)+1}:l):[...r.loads,{id:newId(),name:it.name,value:0,unit:'W' as const,libId:id,qty:1}]};}));
    setMessage(`Added ${it.name} to ${room.name}.`);
  }
  function deleteLibItem(id:string){
    pushHistory();
    setRooms(v=>v.map(r=>r.loads.some(l=>l.libId===id)?{...r,loads:r.loads.filter(l=>l.libId!==id)}:r));
    setLibrary(l=>l.filter(i=>i.id!==id));
  }
  function switchModule(id:ModuleId){
    if(id===settings.activeModule)return;
    setSettings(st=>({...st,activeModule:id}));
    if(id!=='hvac'){setSelectedEquip(null);if(tool==='equip')setTool('select');}
    if(id!=='plumb'){setSelectedFix(null);if(tool==='fixture')setTool('select');}
    setMessage(`${moduleById(id).name} module.`);
  }
  const styleOf=(type:string)=>type===FIXTURE_STYLE?settings.equipStyle[type]??{color:'#0e7490',opacity:0.12}:settings.equipStyle[type]??{color:equipType(type).color,opacity:DEFAULT_EQUIP_OPACITY};
  // The template picker follows the selected room.
  useEffect(()=>{setTplChoice(rooms.find(r=>r.id===selectedId)?.template??'');},[selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  function applyTemplateTo(room:Room,id:string){
    const t=findTemplate(id);if(!t)return;
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?applyTemplate(r,t):r));
    setMessage(`Applied "${t.name}" to ${room.name}. Values are starting points; verify against the adopted code.`);
  }
  function saveRoomAsTemplate(room:Room){
    const name=window.prompt('Template name:',room.name);if(!name?.trim())return;
    const t=templateFromRoom(room,name.trim());
    setSettings(st=>({...st,roomTemplates:[...st.roomTemplates,t]}));
    pushHistory();updateRoom({template:t.id},room.id);setTplChoice(t.id);
    setMessage(`Saved template "${t.name}". It's available in every project in this browser.`);
  }
  function deleteRoomTemplate(id:string){
    const t=findTemplate(id);if(!t||t.builtin||!window.confirm(`Delete the template "${t.name}"?`))return;
    setSettings(st=>({...st,roomTemplates:st.roomTemplates.filter(x=>x.id!==id)}));setTplChoice('');
  }
  const toggleSec=(k:string)=>setSettings(st=>({...st,sections:{...st.sections,[k]:!(st.sections[k]??true)}}));
  // Measure the selected label so the selection box and resize handle fit it exactly.
  useLayoutEffect(()=>{
    const el=labelSel&&selectedId?labelRefs.current.get(selectedId):null;
    const b=el?el.getBBox():null;
    const next=b?{x:b.x,y:b.y,width:b.width,height:b.height}:null;
    setLabelBox(prev=>JSON.stringify(prev)===JSON.stringify(next)?prev:next);
  });
  const lastClickRef=useRef<{t:number;x:number;y:number}|null>(null);
  const worldRef=useRef<HTMLDivElement>(null),sheetRef=useRef<HTMLDivElement>(null);
  const selected=rooms.find(r=>r.id===selectedId);
  const feetPerPoint=scale==='custom'?customFeetPerPoint:scaleFeetPerPoint(scale);
  const sf=(px:number)=>feetPerPoint===null?null:px*feetPerPoint*feetPerPoint;
  const roomArea=(r:Room)=>sf(netAreaPx(r)); // net = outline minus cutouts
  // Nudge step in PDF points: 1" (Shift: 1'-0"). Uncalibrated: 1 pt (Shift: 12 pt).
  // New labels: about 1 ft tall in real-world terms, kept between 4 and 14 PDF points.
  const defaultLabelSize=()=>feetPerPoint===null?DEFAULT_LABEL_SIZE:Math.max(4,Math.min(14,Math.round(1/feetPerPoint*2)/2));
  const nudgeStep=(big:boolean)=>feetPerPoint===null?(big?12:1):(big?1:1/12)/feetPerPoint;

  useEffect(()=>{
    if(!pdf||!canvasRef.current)return;
    let cancelled=false;let task:ReturnType<pdfjsLib.PDFPageProxy['render']>|undefined;
    pageRef.current=null;if(detailRef.current)detailRef.current.style.display='none';
    (async()=>{const page=await pdf.getPage(pageNumber);const vp=page.getViewport({scale:1});if(cancelled)return;
      setPageSize({width:vp.width,height:vp.height});const canvas=canvasRef.current;if(!canvas)return;
      const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(vp.width*ratio);canvas.height=Math.round(vp.height*ratio);
      canvas.style.width=`${vp.width}px`;canvas.style.height=`${vp.height}px`;
      const ctx=canvas.getContext('2d');if(!ctx)return;
      task=page.render({canvasContext:ctx,canvas,viewport:page.getViewport({scale:ratio})});
      try{await task.promise;}catch(e){if(!cancelled)console.error(e);}
      if(!cancelled){pageRef.current=page;scheduleDetail();}
    })().catch(console.error);
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>{detailTaskRef.current?.cancel();if(detailTimerRef.current)clearTimeout(detailTimerRef.current);if(movingTimerRef.current)clearTimeout(movingTimerRef.current);},[]);
  useEffect(()=>{const onResize=()=>scheduleDetail();window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  function scheduleDetail(){
    if(detailTimerRef.current)clearTimeout(detailTimerRef.current);
    detailTimerRef.current=setTimeout(()=>{detailTimerRef.current=null;void renderDetail();},160);
  }
  async function renderDetail(){
    const page=pageRef.current,out=detailRef.current,view=scrollRef.current;if(!page||!out||!view)return;
    const dpr=Math.min(window.devicePixelRatio||1,3),base=Math.min(window.devicePixelRatio||1,2),z=zoomRef.current;
    if(z*dpr<=base*1.05){out.style.display='none';return;} // the base canvas is already sharp enough
    const {x:ox,y:oy}=offsetRef.current,pvp=page.getViewport({scale:1}),pw=pvp.width,ph=pvp.height;
    // Visible part of the page (page units) plus a margin so short pans stay sharp.
    let x0=-ox/z,y0=-oy/z,x1=(view.clientWidth-ox)/z,y1=(view.clientHeight-oy)/z;
    const mx=(x1-x0)*0.15,my=(y1-y0)*0.15;
    x0=Math.max(0,x0-mx);y0=Math.max(0,y0-my);x1=Math.min(pw,x1+mx);y1=Math.min(ph,y1+my);
    if(x1<=x0||y1<=y0){out.style.display='none';return;}
    const w=x1-x0,h=y1-y0;
    const sc=Math.min(z*dpr,Math.sqrt(24e6/(w*h)),16000/Math.max(w,h)); // keep the bitmap a sane size
    const tmp=document.createElement('canvas');tmp.width=Math.ceil(w*sc);tmp.height=Math.ceil(h*sc);
    const ctx=tmp.getContext('2d');if(!ctx)return;
    detailTaskRef.current?.cancel();
    const task=page.render({canvasContext:ctx,canvas:tmp,viewport:page.getViewport({scale:sc,offsetX:-x0*sc,offsetY:-y0*sc})});
    detailTaskRef.current=task;
    try{await task.promise;}catch{return;} // cancelled by a newer render
    if(detailTaskRef.current!==task)return;
    out.width=tmp.width;out.height=tmp.height;out.getContext('2d')?.drawImage(tmp,0,0);
    Object.assign(out.style,{display:'block',left:`${x0}px`,top:`${y0}px`,width:`${w}px`,height:`${h}px`});
  }

  const snapshot=JSON.stringify({pdfName,pageNumber,scale,customFeetPerPoint,altitudeFt,peopleSensible,library,fixtureTypes,rooms});
  useEffect(()=>{
    if(!initializedRef.current){initializedRef.current=true;lastSnapshotRef.current=snapshot;return;}
    setDirty(snapshot!==lastSnapshotRef.current);
  },[snapshot]);
  useEffect(()=>{if(!dirty)return;try{localStorage.setItem('hvac-studio-recovery',JSON.stringify({version:1,pdfName,pageNumber,scale,customFeetPerPoint,altitudeFt,peopleSensible,library,fixtureTypes,rooms}));}catch{/* storage unavailable */}},[dirty,snapshot]);
  useEffect(()=>()=>{if(zoomLabelTimerRef.current!==null)clearTimeout(zoomLabelTimerRef.current);},[]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{
    // Settings dialog: capture a new shortcut key, or just let Escape close it.
    if(capturing){
      e.preventDefault();
      if(e.key==='Escape'){setCapturing(null);setCaptureNote('');return;}
      if(e.metaKey||e.ctrlKey||e.altKey)return;
      const k=e.key.length===1?e.key.toLowerCase():e.key;
      if(RESERVED_KEYS.includes(k.toLowerCase())||!(k.length===1||/^F\d{1,2}$/.test(k))){setCaptureNote(`${keyLabel(k)} is reserved. Pick a letter, number or F-key.`);return;}
      const other=ACTIONS.find(a=>a.id!==capturing&&settings.shortcuts[a.id]===k);
      setSettings(st=>({...st,shortcuts:{...st.shortcuts,[capturing]:k,...(other?{[other.id]:st.shortcuts[capturing]}:{})}}));
      setCaptureNote(other?`${keyLabel(k)} was used by "${other.label}" — swapped, it is now ${keyLabel(settings.shortcuts[capturing])}.`:'');
      setCapturing(null);return;
    }
    if(settingsOpen){if(e.key==='Escape')setSettingsOpen(false);return;}
    if(reportsOpen){if(e.key==='Escape'&&!isTyping(e.target))setReportsOpen(false);return;}
    if(libraryOpen!==false){if(e.key==='Escape'&&!isTyping(e.target))setLibraryOpen(false);return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void saveProject();return;}
    if(isTyping(e.target))return;
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return;}
    const mod=e.metaKey||e.ctrlKey,k0=e.key.toLowerCase();
    // Hold space to pan (handled in onPanDown); never let it press a focused button.
    if(e.key===' '&&!mod){e.preventDefault();if(document.activeElement instanceof HTMLButtonElement)document.activeElement.blur();
      if(!spaceRef.current){spaceRef.current=true;setSpaceHeld(true);}return;}
    // Equipment: duplicate, copy, paste (paste goes into the room under the cursor).
    if(mod&&k0==='a'){e.preventDefault();if(tool!=='select')switchTool('select');const ids=rooms.map(r=>r.id);setSelection(ids,ids[ids.length-1]??null);
      setMessage(`All ${ids.length} rooms selected. Drag any of them, or use the arrow keys, to move them together.`);return;}
    const curEquip=selected?.equipment.find(x=>x.id===selectedEquip);
    const curFix=selected?.fixtures?.find(x=>x.id===selectedFix);
    // R rotates: the symbol being placed, or the selected fixture / equipment.
    if(k0==='r'&&!mod&&!e.altKey){
      if(tool==='fixture'||tool==='equip'){e.preventDefault();const n=(placeRot+90)%360;setPlaceRot(n);setMessage(`Rotation ${n}°.`);return;}
      if(curFix&&selected){e.preventDefault();pushHistory();updateFixIn(selected.id,curFix.id,{rot:(curFix.rot+90)%360});return;}
      if(curEquip&&selected){e.preventDefault();pushHistory();updateEquipIn(selected.id,curEquip.id,{rot:((curEquip.rot??0)+90)%180});return;}
      return;
    }
    if(mod&&k0==='d'&&curFix&&selected){e.preventDefault();const t=cloneFixture(curFix,selected);if(t)setMessage(`Duplicated ${t.tag}.`);return;}
    if(mod&&k0==='c'&&curFix){fixClipRef.current={...curFix};clipboardRef.current=null;setMessage(`Copied ${fixType(curFix.typeId)?.tag??'fixture'}. Point at a room and press Ctrl/Cmd+V to paste.`);return;}
    if(mod&&k0==='v'&&fixClipRef.current){
      const hp=hoverRef.current,under=hp?roomAt(hp):undefined,target=under??selected;
      if(!target){setMessage('Point at a room (or select one) to paste the fixture into it.');return;}
      e.preventDefault();const t=cloneFixture(fixClipRef.current,target,under?hp!:undefined);if(t)setMessage(`Pasted ${t.tag} into ${target.name}.`);return;
    }
    if(mod&&k0==='d'&&curEquip&&selected){e.preventDefault();const c=cloneInto(curEquip,selected);setMessage(`Duplicated ${curEquip.tag||curEquip.type} as ${c.tag}.`);return;}
    if(mod&&k0==='c'&&curEquip){clipboardRef.current={...curEquip};fixClipRef.current=null;setMessage(`Copied ${curEquip.tag||curEquip.type}. Point at a room and press Ctrl/Cmd+V to paste.`);return;}
    if(mod&&k0==='v'&&clipboardRef.current){
      const hp=hoverRef.current,under=hp?roomAt(hp):undefined,target=under??selected;
      if(!target){setMessage('Point at a room (or select one) to paste equipment into it.');return;}
      e.preventDefault();const c=cloneInto(clipboardRef.current,target,under?hp!:undefined);setMessage(`Pasted ${c.tag} into ${target.name}.`);return;
    }
    if(e.target instanceof HTMLButtonElement&&e.key==='Enter')return;
    if(e.key==='Escape'&&!(selectedEdge||labelSel||selectedEquip||selectedFix||draftRef.current.length||tool!=='select'))setSelectedId(null);
    if(e.key==='Escape'){setDraft([]);setRectStart(null);setRectEnd(null);rectRef.current=null;pressRef.current=null;setCalPoints([]);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);setSelectedFix(null);
      if(tool==='equip'||tool==='fixture')switchTool('select');}
    if(e.key==='Backspace'||e.key==='Delete'){
      e.preventDefault();
      if(draftRef.current.length){setDraft(v=>v.slice(0,-1));return;}
      if(tool==='select'&&selected&&selectedEquip){removeEquip(selected.id,selectedEquip);return;}
      if(tool==='select'&&selected&&selectedFix){removeFixture(selected.id,selectedFix);return;}
      if(tool==='select'&&selected&&selectedEdge&&selectedEdge.ring>=0){deleteCutout(selectedEdge.ring);return;}
      if(e.key==='Delete'&&tool==='select'&&(selected||selIds.length))deleteRoom();
      return;
    }
    if(e.key==='Enter'&&(tool==='draw'||tool==='cutout')){e.preventDefault();finishRoom();}
    if(tool==='select'&&selected&&selectedEquip&&e.key.startsWith('Arrow')&&!(e.target instanceof HTMLInputElement)){e.preventDefault();nudgeEquip(e.key,e.shiftKey);return;}
    if(tool==='select'&&selected&&selectedFix&&e.key.startsWith('Arrow')&&!(e.target instanceof HTMLInputElement)){e.preventDefault();nudgeFix(e.key,e.shiftKey);return;}
    // Selected label: arrows move it (1 pt, Shift 10 pt); + / - resize it.
    if(tool==='select'&&selected&&labelSel&&!(e.target instanceof HTMLInputElement)){
      const d={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];
      if(d){e.preventDefault();const st=e.shiftKey?10:1,cur=selected.labelPos??labelPoint(selected);
        pushHistory();updateRoom({labelPos:{x:cur.x+d[0]*st,y:cur.y+d[1]*st}},selected.id);return;}
      if(e.key==='+'||e.key==='='||e.key==='-'||e.key==='_'){e.preventDefault();
        const size=selected.labelSize??DEFAULT_LABEL_SIZE,next=Math.max(2,Math.min(72,size+(e.key==='-'||e.key==='_'?-0.5:0.5)));
        pushHistory();updateRoom({labelSize:next},selected.id);setMessage(`Label size ${fmt(next)} pt.`);return;}
    }
    if(e.key.startsWith('Arrow')&&tool==='select'&&selected){
      if(e.target instanceof HTMLInputElement)return; // e.g. the opacity slider has focus
      e.preventDefault();nudge(e.key,e.shiftKey);return;
    }
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.repeat){
      const k=e.key.length===1?e.key.toLowerCase():e.key;
      const action=ACTIONS.find(a=>settings.shortcuts[a.id]===k);
      if(action){e.preventDefault();runAction(action.id);}
    }
  };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });
  useEffect(()=>{
    const up=(e:KeyboardEvent)=>{if(e.key===' '&&spaceRef.current){spaceRef.current=false;setSpaceHeld(false);}};
    const reset=()=>{spaceRef.current=false;setSpaceHeld(false);};
    window.addEventListener('keyup',up);window.addEventListener('blur',reset);
    return()=>{window.removeEventListener('keyup',up);window.removeEventListener('blur',reset);};
  },[]);
  async function importPdf(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;
    if(rooms.length&&!window.confirm('Start a new takeoff from this PDF? This clears the current rooms.\n\nTo keep your rooms and just swap the drawing, cancel and use "Replace background" instead.')){e.target.value='';return;}
    try{const data=new Uint8Array(await file.arrayBuffer());const doc=await pdfjsLib.getDocument({data:data.slice()}).promise;
      pdfBytesRef.current=data.slice() as Uint8Array<ArrayBuffer>;projectHandleRef.current=null;setProjectName('Untitled.hvac.json');
      historyRef.current=[];setPdf(doc);setPdfName(file.name);setPageNumber(1);setRooms([]);setDraft([]);setSelectedId(null);setCalPoints([]);setScale('1/8');setCustomFeetPerPoint(null);setTool('select');setZoom(1);zoomRef.current=1;offsetRef.current={x:20,y:20};
      setMessage(`PDF loaded. Set the drawing scale, then press ${keyLabel(settings.shortcuts.draw)} to draw rooms along inside wall faces.`);
    }catch(err){console.error(err);setMessage('Unable to open PDF.');}e.target.value='';}
  // Swap the background drawing but keep every room, the scale and the project file.
  async function replacePdf(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{const data=new Uint8Array(await file.arrayBuffer());const doc=await pdfjsLib.getDocument({data:data.slice()}).promise;
      const page=pageNumber<=doc.numPages?pageNumber:1,vp=(await doc.getPage(page)).getViewport({scale:1});
      const sameSize=Math.abs(vp.width-pageSize.width)<1&&Math.abs(vp.height-pageSize.height)<1;
      pdfBytesRef.current=data.slice() as Uint8Array<ArrayBuffer>;setPdf(doc);setPdfName(file.name);setPageNumber(page);
      setMessage(`Background replaced with ${file.name}${doc.numPages>1?` (page ${page})`:''}. Rooms kept.${sameSize?'':' The new sheet is a different size.'} If the plan shifted, press Ctrl/Cmd+A, then drag or use the arrow keys to realign.${scale==='custom'?' Check the custom calibration still matches.':''}`);
    }catch(err){console.error(err);setMessage('Unable to open that PDF. The current background was kept.');}}
  function projectData():ProjectFile{return {version:1,pdfName,pdfBase64:pdfBytesRef.current?bytesToBase64(pdfBytesRef.current):null,pageNumber,scale,customFeetPerPoint,altitudeFt,peopleSensible,library,fixtureTypes,rooms};}
  function downloadProject(content:string,name:string){const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  async function saveProject(saveAs=false){
    const content=JSON.stringify(projectData());
    try{
      let handle=saveAs?null:projectHandleRef.current;
      if(!handle){const picker=(window as FilePickerWindow).showSaveFilePicker;
        if(picker){handle=await picker({suggestedName:projectName,types:[{description:'HVAC Studio Project',accept:{'application/json':['.json']}}]});projectHandleRef.current=handle;setProjectName(handle.name);}
        else{downloadProject(content,projectName);setMessage('Project downloaded. This browser does not support direct overwrite; use desktop Chrome for Save to same file.');return;}
      }
      const writable=await handle.createWritable();await writable.write(content);await writable.close();
      lastSnapshotRef.current=JSON.stringify({pdfName,pageNumber,scale,customFeetPerPoint,altitudeFt,peopleSensible,library,fixtureTypes,rooms});setDirty(false);
      setMessage(`Saved ${handle.name}`);
    }catch(err){if((err as Error).name!=='AbortError'){console.error(err);setMessage('Save failed. Please try Save As.');}}
  }
  async function loadProject(file:File,handle:WritableHandle|null){
    try{const parsed=JSON.parse(await file.text()) as ProjectFile;
      if(parsed.version!==1||!Array.isArray(parsed.rooms))throw new Error('Invalid project file');
      let doc:pdfjsLib.PDFDocumentProxy|null=null;let bytes:Uint8Array<ArrayBuffer>|null=null;
      if(parsed.pdfBase64){bytes=base64ToBytes(parsed.pdfBase64) as Uint8Array<ArrayBuffer>;doc=await pdfjsLib.getDocument({data:bytes.slice()}).promise;}
      historyRef.current=[];pdfBytesRef.current=bytes;setPdf(doc);setPdfName(parsed.pdfName||'No PDF');setPageNumber(parsed.pageNumber||1);
      setScale(parsed.scale||'1/8');setCustomFeetPerPoint(parsed.customFeetPerPoint??null);const fpp=(parsed.scale||'1/8')==='custom'?parsed.customFeetPerPoint??null:scaleFeetPerPoint(parsed.scale||'1/8');
      const loadedRooms=placeMissingEquipment(parsed.rooms.map(normalizeRoom),fpp?1/fpp:9);setRooms(loadedRooms);setAltitudeFt(parsed.altitudeFt??0);
      // People heat used to be stored per room; take it from the first room in older files.
      const ps=parsed.peopleSensible??(parsed.rooms[0] as {peopleSensible?:number}|undefined)?.peopleSensible??250,lib=normalizeLibrary(parsed.library);
      const ft=normalizeFixtureTypes(parsed.fixtureTypes);
      setPeopleSensible(ps);setLibrary(lib);setFixtureTypes(ft);setSelectedId(null);setDraft([]);setTool('select');setZoom(1);zoomRef.current=1;offsetRef.current={x:20,y:20};
      projectHandleRef.current=handle;setProjectName(file.name);lastSnapshotRef.current=JSON.stringify({pdfName:parsed.pdfName||'No PDF',pageNumber:parsed.pageNumber||1,scale:parsed.scale||'1/8',customFeetPerPoint:parsed.customFeetPerPoint??null,altitudeFt:parsed.altitudeFt??0,peopleSensible:ps,library:lib,fixtureTypes:ft,rooms:loadedRooms});setDirty(false);
      setMessage(`Opened ${file.name}. Cmd+S saves changes to this project${handle?' directly':''}.`);
    }catch(err){console.error(err);setMessage('Could not open this HVAC Studio project.');}
  }
  async function openProject(){try{const picker=(window as FilePickerWindow).showOpenFilePicker;
    if(picker){const [handle]=await picker({types:[{description:'HVAC Studio Project',accept:{'application/json':['.json']}}]});if(handle)await loadProject(await handle.getFile(),handle as unknown as WritableHandle);}
    else document.getElementById('hvac-project-input')?.click();
  }catch(err){if((err as Error).name!=='AbortError')setMessage('Could not open project.');}}
  function pointFromEvent(e:ReactPointerEvent<SVGSVGElement>):Point {const svg=svgRef.current!;const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const matrix=svg.getScreenCTM();if(!matrix)return {x:0,y:0};
    // Return a plain object: SVGPoint's x/y are prototype getters, so {...svgPoint} would be empty.
    const q=p.matrixTransform(matrix.inverse());return {x:q.x,y:q.y};}
  function addRoom(points:Point[]){
    const id=newId(),name=`Room ${rooms.length+101}`;
    pushHistory();
    setRooms(v=>[...v,normalizeRoom({id,name,points:points.map(p=>({x:p.x,y:p.y})),labelSize:defaultLabelSize()})]);
    setSelectedId(id);draftRef.current=[];setDraft([]);setHover(null);setRectStart(null);setRectEnd(null);rectRef.current=null;
    setMessage(`${name} created. ${feetPerPoint===null?'Calibrate the scale to calculate SF.':'Area calculated from inside-face polygon.'}`);
  }
  function switchTool(t:Tool){
    if(t==='fixture'){
      if(!fixtureTypes.length){openLibraries('plumbing');setMessage('Pick the fixtures this project uses first, then place them.');return;}
      if(!fixtureTypes.some(x=>x.id===placeFixType))setPlaceFixType(fixtureTypes[0].id);
      if(settings.activeModule!=='plumb')setSettings(st=>({...st,activeModule:'plumb'}));
      setSelectedFix(null);
    }
    if(t==='equip'&&settings.activeModule!=='hvac')setSettings(st=>({...st,activeModule:'hvac'}));
    setTool(t);draftRef.current=[];setDraft([]);pressRef.current=null;rectRef.current=null;setRectStart(null);setRectEnd(null);setCalPoints([]);
    if(t==='draw')setMessage('Draw: click-drag for a rectangle, or click corners for a polygon.');
    if(t==='cutout')setMessage('Cutout: click-drag for a rectangle, or click corners for a polygon. It goes into the selected room, or the room that contains it.');
    if(t==='calibrate')setMessage('Click two points of a known dimension to calibrate.');
    if(t==='select')setMessage('Select: click a room, its label, a wall, or a piece of equipment.');
    if(t==='equip')setMessage('Place equipment: pick a type, R rotates, click inside a room. Esc goes back to Select.');
    if(t==='fixture'){const ft=fixtureTypes.find(x=>x.id===placeFixType)??fixtureTypes[0];if(ft)setMessage(`Placing ${ft.tag} · ${ft.name}. Press ${sc('fixture')} again for the next fixture · R rotates · click inside a room · Esc to stop.`);}
  }
  function runAction(a:Action){
    // Fixture key: first press picks up the last fixture used; each further press cycles to the next one.
    if(a==='fixture'&&tool==='fixture'&&fixtureTypes.length){
      const i=fixtureTypes.findIndex(x=>x.id===placeFixType),n=fixtureTypes[(i+1)%fixtureTypes.length];
      setPlaceFixType(n.id);setMessage(`Placing ${n.tag} · ${n.name} (${fixtureTypes.indexOf(n)+1} of ${fixtureTypes.length}). ${sc('fixture')} again for the next fixture · R rotates.`);return;
    }
    if(a==='fit'){if(pdf)fitPage();return;}
    if(a==='table'){setSettings(st=>({...st,table:{...st.table,open:!st.table.open}}));return;}
    if(a==='snap'){setOrthogonal(!orthogonal);setMessage(`15° snap ${orthogonal?'off':'on'}.`);return;}
    switchTool(a);
  }
  // Cutout: goes into the selected room if it fits there, otherwise into the
  // smallest room that fully contains it. Must not overlap an existing cutout.
  function addCutout(pts:Point[]){
    if(!isSimplePolygon(pts)){setMessage('Cutout walls cross each other. Backspace to fix, or Esc to start over.');return;}
    const fits=(r:Room)=>ringInside(pts,r.points)&&!cutoutsOf(r).some(c=>ringsOverlap(c,pts));
    const target=rooms.find(r=>r.id===selectedId&&fits(r))??rooms.filter(fits).sort((a,b)=>areaPx(a.points)-areaPx(b.points))[0];
    if(!target){setMessage('A cutout must sit entirely inside one room and not overlap another cutout. Backspace to adjust, or Esc to cancel.');return;}
    pushHistory();
    const updated={...target,cutouts:[...cutoutsOf(target),pts.map(p=>({x:p.x,y:p.y}))]};
    setRooms(v=>v.map(r=>r.id===target.id?updated:r));
    setSelectedId(target.id);draftRef.current=[];setDraft([]);setHover(null);
    const cut=sf(areaPx(pts)),net=roomArea(updated);
    setMessage(cut===null?`Cutout added to ${target.name}.`:`Cutout of ${fmt(cut)} SF removed from ${target.name}. Net area now ${fmt(net!)} SF.`);
  }
  function deleteCutout(k:number){
    if(!selected)return;pushHistory();
    setRooms(v=>v.map(r=>r.id===selected.id?{...r,cutouts:cutoutsOf(r).filter((_,i)=>i!==k)}:r));
    setSelectedEdge(null);setMessage(`Cutout removed from ${selected.name}.`);
  }
  function deleteRoom(){
    const ids=selIds.length?selIds:selected?[selected.id]:[];if(!ids.length)return;pushHistory();
    setRooms(v=>v.filter(r=>!ids.includes(r.id)));setSelectedId(null);
    setMessage(`${ids.length===1?(rooms.find(r=>r.id===ids[0])?.name??'Room'):`${ids.length} rooms`} deleted. Ctrl/Cmd+Z to undo.`);
  }
  // The smallest other room this room sits inside (for "cut out of" in the properties panel).
  function containerOf(room:Room){
    return rooms.filter(r=>r.id!==room.id&&ringInside(room.points,r.points)&&!cutoutsOf(r).some(c=>ringsOverlap(c,room.points)))
      .sort((a,b)=>areaPx(a.points)-areaPx(b.points))[0];
  }
  function cutFromContainer(room:Room){
    const host=containerOf(room);if(!host)return;pushHistory();
    setRooms(v=>v.map(r=>r.id===host.id?{...r,cutouts:[...cutoutsOf(r),room.points.map(p=>({x:p.x,y:p.y}))]}:r));
    setMessage(`${room.name}'s outline is now cut out of ${host.name}.`);
  }
  function undo(){
    if(draftRef.current.length){setDraft(v=>v.slice(0,-1));return;}
    const prev=historyRef.current.pop();
    if(!prev){setMessage('Nothing to undo.');return;}
    setRooms(prev);setSelectedEdge(null);
    setSelIds(ids=>ids.filter(id=>prev.some(r=>r.id===id)));
    if(selectedId&&!prev.some(r=>r.id===selectedId))setSelectedId(null);
    setMessage('Undone.');
  }
  // ---- Equipment ----
  const ptPerFt=feetPerPoint?1/feetPerPoint:9; // uncalibrated drawings are drawn as if 1/8" = 1'-0"
  const symbolPt=(e:Equip)=>{const z=equipSize(e),r=(e.rot??0)%180!==0;return {w:(r?z.h:z.w)*ptPerFt,h:(r?z.w:z.h)*ptPerFt};};
  // Smallest room containing the point, outside its cutouts.
  function roomAt(p:Point,list=rooms){
    return list.filter(r=>pointInRing(p,r.points)&&!cutoutsOf(r).some(c=>pointInRing(p,c)))
      .sort((a,b)=>areaPx(a.points)-areaPx(b.points))[0];
  }
  function nextTag(prefix:string,list=rooms){
    const re=new RegExp(`^${prefix}-(\\d+)$`);
    const n=list.flatMap(r=>r.equipment).reduce((mx,e)=>{const m=re.exec(e.tag);return m?Math.max(mx,Number(m[1])):mx;},0);
    return `${prefix}-${n+1}`;
  }
  const roundUp5=(v:number)=>Math.max(0,Math.ceil(v/5)*5);
  const spotFor=(room:Room,e:Equip)=>freeSpot(room,[labelObstacle(room),...equipObstacles(room,ptPerFt,e.id)],equipRadiusFt(e)*ptPerFt);
  // A new unit, pre-sized to cover whatever the room's existing equipment doesn't.
  function buildEquip(room:Room,type:string,pos?:Point):Equip{
    const m=mOf(room),e=newEquip(type,nextTag(equipType(type).prefix));
    const coolLeft=(m.coolingLoad??0)-m.coolCap,heatLeft=(m.heatingLoad??0)-m.heatCap;
    if(e.method==='oa')e.coolCfm=roundUp5((m.voz??0)-m.oa);
    else if(e.method==='air'){
      if(e.cools&&coolLeft>0&&room.coolSetpoint>e.coolLat)e.coolCfm=roundUp5(coolLeft/(m.factor*(room.coolSetpoint-e.coolLat)));
      if(e.heats&&heatLeft>0&&e.heatLat>room.heatSetpoint)e.heatCfm=roundUp5(heatLeft/(m.factor*(e.heatLat-room.heatSetpoint)));
      if(e.type==='Fan Coil'&&e.cools&&e.heats){const f=Math.max(e.coolCfm,e.heatCfm);e.coolCfm=f;e.heatCfm=f;} // one fan speed
    }else{if(e.cools&&coolLeft>0)e.coolCap=Math.round(coolLeft);if(e.heats&&heatLeft>0)e.heatCap=Math.round(heatLeft);}
    e.pos=pos??spotFor(room,e);
    return e;
  }
  function selectEquip(roomId:string,id:string){
    setSelIds([roomId]);setSelectedIdRaw(roomId);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(id);
    setSettings(st=>st.rightOpen&&st.sections.hvac!==false?st:{...st,rightOpen:true,sections:{...st.sections,hvac:true}});
  }
  function addEquipTo(room:Room,type:string,pos?:Point,rot=0){
    const e=buildEquip(room,type,pos);e.rot=rot;
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?{...r,equipment:[...r.equipment,e]}:r));
    selectEquip(room.id,e.id);
    setMessage(`Added ${e.tag} to ${room.name}. Drag it into place · Delete removes · Ctrl/Cmd+D duplicates.`);
  }
  function updateEquipIn(roomId:string,id:string,ch:Partial<Equip>){
    setRooms(v=>v.map(r=>r.id===roomId?{...r,equipment:r.equipment.map(e=>e.id===id?{...e,...ch}:e)}:r));
  }
  function removeEquip(roomId:string,id:string){
    const room=rooms.find(r=>r.id===roomId),e=room?.equipment.find(x=>x.id===id);if(!room||!e)return;
    pushHistory();setRooms(v=>v.map(r=>r.id===roomId?{...r,equipment:r.equipment.filter(x=>x.id!==id)}:r));
    if(selectedEquip===id)setSelectedEquip(null);if(hoverEquip===id)setHoverEquip(null);
    setMessage(`Removed ${e.tag||e.type} from ${room.name}. Ctrl/Cmd+Z to undo.`);
  }
  // Copy of a unit with a new tag: beside the original if it fits, at the given point, or anywhere free.
  function cloneInto(src:Equip,room:Room,at?:Point){
    const e:Equip={...src,id:newId(),tag:nextTag(equipType(src.type).prefix)};
    let pos=at;
    if(!pos&&src.pos){const c={x:src.pos.x+symbolPt(src).w+ptPerFt,y:src.pos.y};if(roomAt(c)?.id===room.id)pos=c;}
    e.pos=pos??spotFor(room,e);
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?{...r,equipment:[...r.equipment,e]}:r));
    selectEquip(room.id,e.id);return e;
  }
  function nudgeEquip(key:string,big:boolean){
    const eq=selected?.equipment.find(x=>x.id===selectedEquip);if(!selected||!eq?.pos)return;
    const d=({ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]} as Record<string,[number,number]>)[key];if(!d)return;
    const st=nudgeStep(big),np={x:eq.pos.x+d[0]*st,y:eq.pos.y+d[1]*st};
    if(roomAt(np)?.id!==selected.id){setMessage(`${eq.tag} would leave ${selected.name}. Drag it to move it to another room.`);return;}
    pushHistory();updateEquipIn(selected.id,eq.id,{pos:np});
  }
  function startEquipDrag(e:ReactPointerEvent<SVGElement>,room:Room,eq:Equip){
    if(tool!=='select'||e.button!==0||!eq.pos)return;
    e.stopPropagation();e.preventDefault();releaseFocus(); // no text selection / native drag that would cancel the pointer stream
    selectEquip(room.id,eq.id);
    equipDragRef.current={roomId:room.id,id:eq.id,start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),startPos:eq.pos,pushed:false};
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  // ---- Plumbing fixtures ----
  const fixType=(id:string)=>fixtureTypes.find(x=>x.id===id);
  const fixPt=(t:FixtureType,rot:number)=>{const r=rot%180!==0;return {w:(r?t.size.h:t.size.w)*ptPerFt,h:(r?t.size.w:t.size.h)*ptPerFt};};
  const fixUsage=(typeId:string)=>rooms.reduce((n,r)=>n+(r.fixtures??[]).filter(f=>f.typeId===typeId).length,0);
  const fixSpot=(room:Room,t:FixtureType,skip?:string)=>freeSpot(room,[labelObstacle(room),...equipObstacles(room,ptPerFt),
    ...(room.fixtures??[]).filter(f=>f.id!==skip).flatMap(f=>{const ft=fixType(f.typeId);return ft?[{p:f.pos,r:Math.hypot(ft.size.w,ft.size.h)/2*ptPerFt}]:[];})],Math.hypot(t.size.w,t.size.h)/2*ptPerFt);
  function selectFixture(roomId:string,id:string){
    setSelIds([roomId]);setSelectedIdRaw(roomId);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);setSelectedFix(id);
    setSettings(st=>st.rightOpen&&st.sections.plumb!==false?st:{...st,rightOpen:true,sections:{...st.sections,plumb:true}});
  }
  function addFixtureTo(room:Room,typeId:string,pos?:Point,rot=0){
    const t=fixType(typeId);if(!t)return;
    const f:PlacedFixture={id:newId(),typeId,pos:pos??fixSpot(room,t),rot};
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?{...r,fixtures:[...(r.fixtures??[]),f]}:r));
    selectFixture(room.id,f.id);
    setMessage(`Placed ${t.tag} in ${room.name}. Drag to position · R rotates · Delete removes · Ctrl/Cmd+D duplicates.`);
  }
  const updateFixIn=(roomId:string,id:string,ch:Partial<PlacedFixture>)=>setRooms(v=>v.map(r=>r.id===roomId?{...r,fixtures:(r.fixtures??[]).map(f=>f.id===id?{...f,...ch}:f)}:r));
  function removeFixture(roomId:string,id:string){
    const room=rooms.find(r=>r.id===roomId),f=room?.fixtures.find(x=>x.id===id);if(!room||!f)return;
    pushHistory();setRooms(v=>v.map(r=>r.id===roomId?{...r,fixtures:r.fixtures.filter(x=>x.id!==id)}:r));
    if(selectedFix===id)setSelectedFix(null);
    setMessage(`Removed ${fixType(f.typeId)?.tag??'fixture'} from ${room.name}. Ctrl/Cmd+Z to undo.`);
  }
  function deleteFixtureType(id:string){
    pushHistory();setRooms(v=>v.map(r=>(r.fixtures??[]).some(f=>f.typeId===id)?{...r,fixtures:r.fixtures.filter(f=>f.typeId!==id)}:r));
    setFixtureTypes(v=>v.filter(t=>t.id!==id));if(placeFixType===id)setPlaceFixType('');setSelectedFix(null);
  }
  // Copy beside the original if it fits in the room, else at the given point or any free spot.
  function cloneFixture(src:PlacedFixture,room:Room,at?:Point){
    const t=fixType(src.typeId);if(!t)return null;
    let pos=at;
    if(!pos){const c={x:src.pos.x+fixPt(t,src.rot).w+ptPerFt,y:src.pos.y};if(roomAt(c)?.id===room.id)pos=c;}
    const f:PlacedFixture={...src,id:newId(),pos:pos??fixSpot(room,t)};
    pushHistory();setRooms(v=>v.map(r=>r.id===room.id?{...r,fixtures:[...(r.fixtures??[]),f]}:r));
    selectFixture(room.id,f.id);return t;
  }
  function nudgeFix(key:string,big:boolean){
    const f=selected?.fixtures.find(x=>x.id===selectedFix);if(!selected||!f)return;
    const d=({ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]} as Record<string,[number,number]>)[key];if(!d)return;
    const st=nudgeStep(big),np={x:f.pos.x+d[0]*st,y:f.pos.y+d[1]*st};
    if(roomAt(np)?.id!==selected.id){setMessage('That would move the fixture out of the room. Drag it to move it to another room.');return;}
    pushHistory();updateFixIn(selected.id,f.id,{pos:np});
  }
  function startFixDrag(e:ReactPointerEvent<SVGElement>,room:Room,f:PlacedFixture){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    selectFixture(room.id,f.id);
    fixDragRef.current={roomId:room.id,id:f.id,start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),startPos:f.pos,pushed:false};
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  // Keep the selected equipment's card in view in the properties panel.
  useEffect(()=>{if(selectedEquip)cardRefs.current.get(selectedEquip)?.scrollIntoView({block:'nearest',behavior:'smooth'});},[selectedEquip]);
  const roomIsValid=(r:Room)=>{
    const cs=cutoutsOf(r);
    return isSimplePolygon(r.points)&&cs.every(c=>isSimplePolygon(c)&&ringInside(c,r.points))
      &&cs.every((c,i)=>cs.every((d,j)=>j<=i||!ringsOverlap(c,d)));
  };
  // Arrow keys: with a wall selected, move that wall across itself; with only a room
  // selected, move the whole room (cutouts included). Shift = 1'-0", otherwise 1".
  function nudge(key:string,big:boolean){
    if(!selected)return;
    const arrows:Record<string,Point>={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}};
    const arrow=arrows[key];if(!arrow)return;
    const step=nudgeStep(big);
    let next:Room;
    if(selectedEdge){
      const ring=selectedEdge.ring<0?selected.points:cutoutsOf(selected)[selectedEdge.ring];
      if(!ring)return;
      const moved=offsetEdge(ring,selectedEdge.index,arrow,step);
      if(!moved){setMessage('That arrow runs along the selected wall. Use an arrow that points across it.');return;}
      next=selectedEdge.ring<0?{...selected,points:moved}:{...selected,cutouts:cutoutsOf(selected).map((c,k)=>k===selectedEdge.ring?moved:c)};
    }else if(selIds.length>1){
      const ids=selIds;pushHistory();
      setRooms(v=>v.map(r=>ids.includes(r.id)?translateRoom(r,arrow.x*step,arrow.y*step):r));
      setMessage(`Nudged ${ids.length} rooms ${big?'1\'-0"':'1"'}.`);return;
    }else{
      const shift=(r:Point[])=>r.map(p=>({x:p.x+arrow.x*step,y:p.y+arrow.y*step}));
      next={...selected,points:shift(selected.points),cutouts:cutoutsOf(selected).map(shift),labelPos:selected.labelPos?shift([selected.labelPos])[0]:selected.labelPos,
        equipment:selected.equipment.map(q=>q.pos?{...q,pos:shift([q.pos])[0]}:q),fixtures:(selected.fixtures??[]).map(f=>({...f,pos:shift([f.pos])[0]}))};
    }
    if(!roomIsValid(next)){setMessage("Can't nudge further: walls would cross or a cutout would leave its room.");return;}
    pushHistory();
    setRooms(v=>v.map(r=>r.id===next.id?next:r));
    const a=roomArea(next);
    setMessage(`Nudged ${big?'1\'-0"':'1"'}${feetPerPoint===null?' (uncalibrated: points)':''}.${a!==null?` ${next.name}: ${fmt(a)} SF net.`:''}`);
  }
  // Single entry point for closing a polygon (first-corner click, double-click, Enter).
  function finishRoom(){
    let pts = draftRef.current.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({...p}));
    // A corner placed on top of the start point isn't a real corner.
    while (pts.length > 3 && dist(pts[pts.length - 1], pts[0]) < 1) pts.pop();
    if (pts.length < 3) { setMessage('Add at least three corners before finishing.'); return; }
    if (orthogonal) { const snapped = closeSnapped(pts); if (snapped) pts = snapped; }
    if (tool === 'cutout') { addCutout(pts); return; }
    addRoom(pts);
    if (!isSimplePolygon(pts)) setMessage('Room created, but its walls cross each other. Delete it and redraw for an accurate area.');
  }
  function onPointerDown(e:ReactPointerEvent<SVGSVGElement>){if(e.button===1){e.preventDefault();return;}if(e.button!==0||!pdf)return;
    const target=e.target as Element;if(tool==='select'&&target!==svgRef.current&&target.getAttribute('data-layer')!=='background')return;
    const p=pointFromEvent(e);
    if(tool==='calibrate'){
      if(!calPoints.length){setCalPoints([p]);setMessage('Click the second point of the known dimension.');}
      else{const length=dist(calPoints[0],p);if(length<2)return;const value=window.prompt('Actual distance in feet:','10');const feet=Number(value);
        if(value!==null&&feet>0){setCustomFeetPerPoint(feet/length);setScale('custom');setTool('select');setMessage(`Custom calibration: ${fmt(length/feet)} PDF points per foot.`);}setCalPoints([]);}
    }else if(tool==='equip'){
      const room=roomAt(p);
      if(!room){setMessage('Click inside a room to place equipment.');return;}
      addEquipTo(room,placeType,p,placeRot%180);
    }else if(tool==='fixture'){
      const room=roomAt(p);
      if(!room){setMessage('Click inside a room to place the fixture.');return;}
      addFixtureTo(room,placeFixType,p,placeRot);
    }else if(tool==='draw'||tool==='cutout'){
      const corners=draftRef.current;
      if(!corners.length){
        // Don't commit yet: a drag makes a rectangle, a plain click starts a polygon.
        pressRef.current={p,x:e.clientX,y:e.clientY,dragging:false};
        lastClickRef.current={t:performance.now(),x:e.clientX,y:e.clientY};
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      // Clicking on/near the first corner closes the room (12 screen px).
      if(corners.length>=3 && dist(p,corners[0])<=12/zoomRef.current){
        finishRoom();
        return;
      }
      // Second press of a double-click: don't add a stray corner; onDoubleClick finishes.
      const prev=lastClickRef.current, now=performance.now();
      lastClickRef.current={t:now,x:e.clientX,y:e.clientY};
      if(prev&&now-prev.t<400&&Math.hypot(e.clientX-prev.x,e.clientY-prev.y)<6)return;
      const last=corners[corners.length-1];
      const next=orthogonal?snapDirection(last,p):p;
      if(dist(last,next)>1){
        draftRef.current=[...corners,next];
        setDraft(draftRef.current);
      }
    }else{
      // Select tool on empty space: box-select (Shift/Ctrl/Cmd adds to the selection).
      marqueeRef.current={start:p,add:e.shiftKey||e.ctrlKey||e.metaKey};setMarquee({a:p,b:p});
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }
  // preventDefault on a press also skips the browser's focus change, so release any focused field
  // ourselves; otherwise arrow keys / Delete would keep going to the last-edited input.
  const releaseFocus=()=>{const a=document.activeElement;if(a instanceof HTMLElement&&a!==document.body)a.blur();};
  const fmtMove=(dx:number,dy:number)=>{const f=(v:number)=>feetPerPoint?fmtFeet(Math.abs(v)*feetPerPoint):`${fmt(Math.abs(v))} pt`;
    return [dx?`${dx>0?'right':'left'} ${f(dx)}`:'',dy?`${dy>0?'down':'up'} ${f(dy)}`:''].filter(Boolean).join(', ')||'0';};
  // Press on a room: select it (Shift/Ctrl/Cmd adds or removes) and drag to move the whole selection.
  function startRoomDrag(e:ReactPointerEvent<SVGElement>,room:Room){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    let ids:string[],collapse=false;
    if(e.shiftKey||e.ctrlKey||e.metaKey){
      ids=selIds.includes(room.id)?selIds.filter(x=>x!==room.id):[...selIds,room.id];
      setSelection(ids,ids.includes(room.id)?room.id:ids[ids.length-1]??null);
      setMessage(`${ids.length} room${ids.length===1?'':'s'} selected.`);
      if(!ids.includes(room.id))return;
    }else if(selIds.includes(room.id)&&selIds.length>1){
      ids=selIds;collapse=true;setSelectedIdRaw(room.id);setSelectedEdge(null);setLabelSel(false);setSelectedEquip(null);
    }else{ids=[room.id];setSelectedId(room.id);}
    moveDragRef.current={ids,start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),orig:new Map(rooms.filter(r=>ids.includes(r.id)).map(r=>[r.id,r])),pushed:false,dx:0,dy:0,clicked:room.id,collapse};
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  // Press on a wall: select it, and dragging moves it across itself (snaps to 1" when scaled).
  function startEdgeDrag(e:ReactPointerEvent<SVGElement>,room:Room,ringIdx:number,index:number){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    setSelIds([room.id]);setSelectedIdRaw(room.id);setSelectedEquip(null);setLabelSel(false);setSelectedEdge({ring:ringIdx,index});
    const ring=ringIdx<0?room.points:cutoutsOf(room)[ringIdx],normal=ring?edgeNormal(ring,index):null;
    if(!ring||!normal)return;
    edgeDragRef.current={roomId:room.id,ring:ringIdx,index,startRing:ring.map(p=>({...p})),start:pointFromEvent(e as unknown as ReactPointerEvent<SVGSVGElement>),normal,pushed:false,dist:0};
    svgRef.current?.setPointerCapture(e.pointerId);
    setMessage(`${ringIdx<0?'Wall':'Cutout wall'} selected. Drag it, or use the arrow keys (1", Shift 1'-0").${ringIdx>=0?' Delete removes this cutout.':''}`);
  }
  const withRing=(room:Room,ringIdx:number,ring:Point[]):Room=>ringIdx<0?{...room,points:ring}:{...room,cutouts:cutoutsOf(room).map((c,k)=>k===ringIdx?ring:c)};
  function startLabelDrag(e:ReactPointerEvent<SVGElement>,room:Room,mode:'move'|'size'){
    if(tool!=='select'||e.button!==0)return;
    e.stopPropagation();e.preventDefault();releaseFocus();
    if(room.id!==selectedId)setSelectedId(room.id);
    setSelectedEdge(null);setLabelSel(true);
    const pos=room.labelPos??labelPoint(room);
    labelDragRef.current={mode,id:room.id,start:pointFromEvent(e as ReactPointerEvent<SVGSVGElement>),startPos:pos,startSize:room.labelSize??DEFAULT_LABEL_SIZE,center:pos,pushed:false};
    svgRef.current?.setPointerCapture(e.pointerId);
    setMessage(mode==='move'?`${room.name} label selected. Drag to move, drag the corner handle to resize, or use + / −.`:'Drag to resize the label.');
  }
  function onPointerMove(e:ReactPointerEvent<SVGSVGElement>){
    const p=pointFromEvent(e);setHover(p);hoverRef.current=p;
    if(marqueeRef.current){setMarquee({a:marqueeRef.current.start,b:p});return;}
    const md=moveDragRef.current;
    if(md){
      let dx=p.x-md.start.x,dy=p.y-md.start.y;
      if(!md.pushed){if(Math.hypot(dx,dy)*zoomRef.current<3)return;pushHistory();md.pushed=true;}
      if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;} // Shift: straight horizontal or vertical
      md.dx=dx;md.dy=dy;
      setRooms(v=>v.map(r=>{const o=md.orig.get(r.id);return o?translateRoom(o,dx,dy):r;}));
      setMessage(`Moving ${md.ids.length} room${md.ids.length===1?'':'s'}: ${fmtMove(dx,dy)}. Hold Shift for straight moves.`);
      return;
    }
    const wd=edgeDragRef.current;
    if(wd){
      let d=(p.x-wd.start.x)*wd.normal.x+(p.y-wd.start.y)*wd.normal.y;
      if(!wd.pushed){if(Math.abs(d)*zoomRef.current<3)return;pushHistory();wd.pushed=true;}
      const unit=feetPerPoint?1/12/feetPerPoint:1;d=Math.round(d/unit)*unit; // whole inches (points when unscaled)
      if(d===wd.dist)return;
      const room=rooms.find(r=>r.id===wd.roomId),moved=offsetEdgeBy(wd.startRing,wd.index,d);if(!room||!moved)return;
      const next=withRing(room,wd.ring,moved);
      if(!roomIsValid(next))return; // stop at the last valid position
      wd.dist=d;setRooms(v=>v.map(r=>r.id===next.id?next:r));
      const na=mOf(next).area;
      setMessage(`Moving wall ${feetPerPoint?fmtFeet(Math.abs(d)*feetPerPoint):`${fmt(Math.abs(d))} pt`}${na!==null?` · ${next.name}: ${fmt(na)} SF`:''}`);
      return;
    }
    const fd=fixDragRef.current;
    if(fd){
      const dx=p.x-fd.start.x,dy=p.y-fd.start.y;
      if(!fd.pushed){if(Math.hypot(dx,dy)*zoomRef.current<3)return;pushHistory();fd.pushed=true;}
      const np={x:fd.startPos.x+dx,y:fd.startPos.y+dy};
      updateFixIn(fd.roomId,fd.id,{pos:np});setDropTarget(roomAt(np)?.id??null);
      return;
    }
    const ed=equipDragRef.current;
    if(ed){
      const dx=p.x-ed.start.x,dy=p.y-ed.start.y;
      if(!ed.pushed){if(Math.hypot(dx,dy)*zoomRef.current<3)return;pushHistory();ed.pushed=true;}
      const np={x:ed.startPos.x+dx,y:ed.startPos.y+dy};
      updateEquipIn(ed.roomId,ed.id,{pos:np});
      setDropTarget(roomAt(np)?.id??null);
      return;
    }
    const ld=labelDragRef.current;
    if(ld){
      const dx=p.x-ld.start.x,dy=p.y-ld.start.y;
      if(!ld.pushed){if(Math.hypot(dx,dy)*zoomRef.current<2)return;pushHistory();ld.pushed=true;}
      if(ld.mode==='move')updateRoom({labelPos:{x:ld.startPos.x+dx,y:ld.startPos.y+dy}},ld.id);
      else{const r0=Math.max(1,dist(ld.start,ld.center)),r1=dist(p,ld.center);
        updateRoom({labelSize:Math.round(Math.max(2,Math.min(72,ld.startSize*r1/r0))*2)/2},ld.id);}
      return;
    }
    const press=pressRef.current;if(!press)return;
    if(!press.dragging&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>5){press.dragging=true;rectRef.current=press.p;setRectStart(press.p);}
    if(press.dragging)setRectEnd(p);
  }
  function onPointerCancel(){
    marqueeRef.current=null;setMarquee(null);
    const md=moveDragRef.current;
    if(md){moveDragRef.current=null;if(md.pushed)setRooms(v=>v.map(r=>md.orig.get(r.id)??r));}
    const wd=edgeDragRef.current;
    if(wd){edgeDragRef.current=null;if(wd.pushed)setRooms(v=>v.map(r=>r.id===wd.roomId?withRing(r,wd.ring,wd.startRing):r));}
    const ed=equipDragRef.current;
    if(ed){equipDragRef.current=null;setDropTarget(undefined);if(ed.pushed)updateEquipIn(ed.roomId,ed.id,{pos:ed.startPos});}
    const fd=fixDragRef.current;
    if(fd){fixDragRef.current=null;setDropTarget(undefined);if(fd.pushed)updateFixIn(fd.roomId,fd.id,{pos:fd.startPos});}
    labelDragRef.current=null;pressRef.current=null;
  }
  function onPointerUp(e:ReactPointerEvent<SVGSVGElement>){
    if(labelDragRef.current){labelDragRef.current=null;return;}
    const mq=marqueeRef.current;
    if(mq){
      marqueeRef.current=null;setMarquee(null);
      const b=pointFromEvent(e);
      if(dist(mq.start,b)*zoomRef.current<4){if(!mq.add)setSelectedId(null);return;} // plain click on empty space
      const box={x0:Math.min(mq.start.x,b.x),y0:Math.min(mq.start.y,b.y),x1:Math.max(mq.start.x,b.x),y1:Math.max(mq.start.y,b.y)};
      const windowMode=b.x>=mq.start.x; // left→right: fully inside; right→left: touching
      const hits=rooms.filter(r=>windowMode?r.points.every(q=>inRect(q,box)):ringTouchesRect(r.points,box)).map(r=>r.id);
      const ids=mq.add?[...selIds,...hits.filter(id=>!selIds.includes(id))]:hits;
      setSelection(ids,ids[ids.length-1]??null);
      setMessage(ids.length?`${ids.length} room${ids.length===1?'':'s'} selected. Drag any of them, or use the arrow keys, to move them together.`:'Nothing selected.');
      return;
    }
    const md=moveDragRef.current;
    if(md){
      moveDragRef.current=null;
      if(!md.pushed){if(md.collapse)setSelectedId(md.clicked);return;} // a click inside a multi-selection picks that room
      setMessage(`Moved ${md.ids.length} room${md.ids.length===1?'':'s'} ${fmtMove(md.dx,md.dy)}. Ctrl/Cmd+Z to undo.`);
      return;
    }
    const wd=edgeDragRef.current;
    if(wd){edgeDragRef.current=null;
      if(wd.pushed){const r=rooms.find(x=>x.id===wd.roomId),a=r?mOf(r).area:null;
        setMessage(`Wall moved ${feetPerPoint?fmtFeet(Math.abs(wd.dist)*feetPerPoint):`${fmt(Math.abs(wd.dist))} pt`}.${a!==null&&r?` ${r.name}: ${fmt(a)} SF.`:''} Ctrl/Cmd+Z to undo.`);}
      return;}
    const fd=fixDragRef.current;
    if(fd){
      fixDragRef.current=null;setDropTarget(undefined);
      if(!fd.pushed)return;
      const q=pointFromEvent(e),pos={x:fd.startPos.x+q.x-fd.start.x,y:fd.startPos.y+q.y-fd.start.y};
      const from=rooms.find(r=>r.id===fd.roomId),f=from?.fixtures.find(x=>x.id===fd.id);if(!from||!f)return;
      const to=roomAt(pos),tag=fixType(f.typeId)?.tag??'Fixture';
      if(!to){updateFixIn(fd.roomId,fd.id,{pos:fd.startPos});setMessage('Fixtures have to sit inside a room, so it went back.');return;}
      if(to.id===from.id){updateFixIn(fd.roomId,fd.id,{pos});return;}
      setRooms(v=>v.map(r=>r.id===from.id?{...r,fixtures:r.fixtures.filter(x=>x.id!==f.id)}:r.id===to.id?{...r,fixtures:[...(r.fixtures??[]),{...f,pos}]}:r));
      selectFixture(to.id,f.id);setMessage(`Moved ${tag} from ${from.name} to ${to.name}.`);
      return;
    }
    const ed=equipDragRef.current;
    if(ed){
      equipDragRef.current=null;setDropTarget(undefined);
      if(!ed.pushed)return;
      // Use the release point itself: the last move may not have rendered yet.
      const q=pointFromEvent(e),pos={x:ed.startPos.x+q.x-ed.start.x,y:ed.startPos.y+q.y-ed.start.y};
      const from=rooms.find(r=>r.id===ed.roomId),eq=from?.equipment.find(x=>x.id===ed.id);if(!from||!eq)return;
      const to=roomAt(pos);
      if(!to){updateEquipIn(ed.roomId,ed.id,{pos:ed.startPos});setMessage('Equipment has to sit inside a room, so it went back.');return;}
      if(to.id===from.id){updateEquipIn(ed.roomId,ed.id,{pos});return;}
      {
        const moved={...eq,pos};
        setRooms(v=>v.map(r=>r.id===from.id?{...r,equipment:r.equipment.filter(x=>x.id!==eq.id)}:r.id===to.id?{...r,equipment:[...r.equipment,moved]}:r));
        selectEquip(to.id,eq.id);setMessage(`Moved ${eq.tag||eq.type} from ${from.name} to ${to.name}.`);
      }
      return;
    }
    const press=pressRef.current;if(!press)return;
    pressRef.current=null;
    if(!press.dragging){draftRef.current=[press.p];setDraft(draftRef.current);return;} // first polygon corner
    const a=press.p,b=pointFromEvent(e);
    rectRef.current=null;setRectStart(null);setRectEnd(null);
    if(Math.abs(a.x-b.x)<3||Math.abs(a.y-b.y)<3)return;
    const pts=[{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.max(a.y,b.y)},{x:Math.min(a.x,b.x),y:Math.max(a.y,b.y)}];
    if(tool==='cutout')addCutout(pts);else addRoom(pts);
  }
  // The drawing is a fixed-size layer. Only its compositor transform changes.
  // No scroll-position adjustments, no layout resizing, no React render per wheel event.
  function updateViewport(){
    const world=worldRef.current;
    if(world){
      world.style.transform=`translate3d(${offsetRef.current.x}px, ${offsetRef.current.y}px, 0) scale(${zoomRef.current})`;
      // Composited layer only while moving; once idle the browser re-rasterizes labels and lines at full sharpness.
      world.classList.add('moving');
      if(movingTimerRef.current)clearTimeout(movingTimerRef.current);
      movingTimerRef.current=setTimeout(()=>{world.classList.remove('moving');movingTimerRef.current=null;},180);
    }
    scheduleDetail();
  }
  function updateZoomLabel(){
    if(zoomLabelTimerRef.current!==null)clearTimeout(zoomLabelTimerRef.current);
    zoomLabelTimerRef.current=setTimeout(()=>{setZoom(zoomRef.current);zoomLabelTimerRef.current=null;},120);
  }
  function applyZoom(next:number,clientX?:number,clientY?:number){
    const viewport=scrollRef.current;if(!viewport)return;
    const old=zoomRef.current;
    next=Math.max(.15,Math.min(8,next));
    if(Math.abs(next-old)<1e-8)return;
    const rect=viewport.getBoundingClientRect();
    const x=(clientX??rect.left+rect.width/2)-rect.left;
    const y=(clientY??rect.top+rect.height/2)-rect.top;
    const {x:ox,y:oy}=offsetRef.current;
    const factor=next/old;
    offsetRef.current={x:x-(x-ox)*factor,y:y-(y-oy)*factor};
    zoomRef.current=next;
    updateViewport();updateZoomLabel();
  }
  function zoomAt(next:number,clientX?:number,clientY?:number){applyZoom(next,clientX,clientY);}
  function onWheel(e:ReactWheelEvent<HTMLElement>){
    if(!pdf)return;
    e.preventDefault();
    // No animation or momentum is added. Each device delta maps directly to zoom.
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?400:1);
    const limited=Math.max(-120,Math.min(120,delta));
    applyZoom(zoomRef.current*Math.exp(-limited*.0012),e.clientX,e.clientY);
  }
  function onPanDown(e:ReactPointerEvent<HTMLElement>){
    const spacePan=spaceRef.current&&e.button===0;
    if((e.button!==1&&!spacePan)||!pdf)return;
    e.preventDefault();e.stopPropagation(); // the drawing never sees a pan click
    panRef.current={x:e.clientX,y:e.clientY,offsetX:offsetRef.current.x,offsetY:offsetRef.current.y};
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  }
  function onPanMove(e:ReactPointerEvent<HTMLElement>){
    if(!panRef.current)return;
    const p=panRef.current;
    offsetRef.current={x:p.offsetX+e.clientX-p.x,y:p.offsetY+e.clientY-p.y};
    updateViewport();
  }
  function endPan(){if(!panRef.current)return;panRef.current=null;setPanning(false);}
  function fitPage(){
    const viewport=scrollRef.current;if(!viewport)return;
    const z=Math.max(.15,Math.min(4,Math.min((viewport.clientWidth-48)/pageSize.width,(viewport.clientHeight-48)/pageSize.height)));
    zoomRef.current=z;
    offsetRef.current={x:(viewport.clientWidth-pageSize.width*z)/2,y:(viewport.clientHeight-pageSize.height*z)/2};
    updateViewport();updateZoomLabel();
  }
  function updateRoom(changes:Partial<Room>,id=selectedId){setRooms(v=>v.map(r=>r.id===id?{...r,...changes}:r));}
  function exportCsv(){
    const raw=(v:number|string|null,dec=1)=>v===null?'':typeof v==='number'?Number(v.toFixed(dec)):v;
    const rows:(string|number)[][]=[[...COLUMNS.map(c=>c.label),'Load Breakdown'],
      ...rooms.map(r=>{const m=mOf(r);return [...COLUMNS.map(c=>raw(c.get(r,m,{tpl:templateName}),c.dec??1)),r.loads.map(l=>`${l.name}: ${tidy(l.value)} ${l.unit}`).join('; ')];})];
    const csv=rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='hvac-room-takeoff.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const edgeRing=selected&&selectedEdge?(selectedEdge.ring<0?selected.points:cutoutsOf(selected)[selectedEdge.ring]):null;
  const edgeA=edgeRing?edgeRing[selectedEdge!.index]:null,edgeB=edgeRing?edgeRing[(selectedEdge!.index+1)%edgeRing.length]:null;
  const edgeLen=edgeA&&edgeB?dist(edgeA,edgeB):null;
  const host=selected?containerOf(selected):undefined;
  const drawColor=tool==='cutout'?'#dc2626':'#2563eb';
  const previewPoint=draft.length&&hover?(orthogonal?snapDirection(draft[draft.length-1],hover):hover):null;
  const rectPreview=rectStart&&rectEnd?[{x:rectStart.x,y:rectStart.y},{x:rectEnd.x,y:rectStart.y},{x:rectEnd.x,y:rectEnd.y},{x:rectStart.x,y:rectEnd.y}]:null;
  return <div className="hvac-app">
    <header className="hvac-header"><div><strong>HVAC Studio</strong><small>Room takeoff & engineering workspace</small></div><small>{projectName}{dirty?" • Unsaved changes":""} · {pdfName}</small></header>
    <div className="hvac-toolbar">
      <input id="hvac-project-input" type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void loadProject(f,null);e.target.value='';}}/>
      <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={importPdf} hidden/>
      <div className="hvac-group"><span className="hvac-group-label">Project</span><div className="hvac-group-items">
        <IconBtn tip="Open project" onClick={()=>void openProject()}><FolderOpen size={17}/></IconBtn>
        <IconBtn tip="Save (Ctrl/Cmd+S)" onClick={()=>void saveProject()}><Save size={17}/></IconBtn>
        <IconBtn tip="Save as…" onClick={()=>void saveProject(true)}><SaveAll size={17}/></IconBtn>
        <IconBtn tip="Libraries: heat-generating equipment, plumbing fixtures" active={libraryOpen!==false} onClick={()=>setLibraryOpen({tab:'heat',item:null})}><Package size={17}/></IconBtn>
      </div></div>
      <div className="hvac-group"><span className="hvac-group-label">PDF</span><div className="hvac-group-items">
        <IconBtn tip="Import PDF (new takeoff)" onClick={()=>fileRef.current?.click()}><Upload size={17}/></IconBtn>
        <input ref={replaceRef} type="file" accept=".pdf,application/pdf" onChange={replacePdf} hidden/>
        <IconBtn tip="Replace background PDF (keeps rooms)" disabled={!pdf} onClick={()=>replaceRef.current?.click()}><RefreshCw size={17}/></IconBtn>
        <select className="hvac-scale-select" title="Drawing scale" aria-label="Drawing scale" value={scale} onChange={e=>{const v=e.target.value;setScale(v);e.currentTarget.blur();if(v==='custom')switchTool('calibrate');}}>{scales.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        <IconBtn tip={`Calibrate scale (${sc('calibrate')})`} active={tool==='calibrate'} onClick={()=>switchTool('calibrate')}><Ruler size={17}/></IconBtn>
        <div className="hvac-layers-wrap">
          <IconBtn tip="Layers" active={layersOpen} onClick={()=>setLayersOpen(v=>!v)}><LayersIcon size={17}/></IconBtn>
          {layersOpen&&<div className="hvac-layers">
            {([['fills','Room fills'],['labels','Room labels'],['labelValues',`${activeModule.short} values on labels`],['equipment','Equipment symbols'],['fixtures','Plumbing fixtures']] as const).map(([k,l])=>
              <label key={k}><input type="checkbox" checked={settings.layers[k]} disabled={k==='labelValues'&&!settings.layers.labels}
                onChange={e=>setSettings(st=>({...st,layers:{...st.layers,[k]:e.target.checked}}))}/> {l}</label>)}
            
          </div>}
        </div>
        <label className="hvac-opacity" data-tip="PDF opacity"><Eye size={16}/><input type="range" min={10} max={100} step={5} value={Math.round(settings.pdfOpacity*100)} aria-label="PDF opacity" onChange={e=>setSettings(st=>({...st,pdfOpacity:Number(e.target.value)/100}))} onPointerUp={e=>e.currentTarget.blur()}/><span>{Math.round(settings.pdfOpacity*100)}%</span></label>
        <IconBtn tip="Zoom out" onClick={()=>zoomAt(Math.max(.15,zoom/1.25))}><ZoomOut size={17}/></IconBtn>
        <span className="hvac-zoom">{Math.round(zoom*100)}%</span>
        <IconBtn tip="Zoom in" onClick={()=>zoomAt(Math.min(8,zoom*1.25))}><ZoomIn size={17}/></IconBtn>
        <IconBtn tip={`Fit page (${sc('fit')})`} disabled={!pdf} onClick={fitPage}><Maximize size={17}/></IconBtn>
      </div></div>
      {MODULES.length>1&&<div className="hvac-group"><span className="hvac-group-label">Module</span><div className="hvac-group-items">
        <div className="hvac-switch" role="tablist" aria-label="Calculation module">
          {MODULES.map(x=><button key={x.id} role="tab" aria-selected={x.id===activeModule.id} className={x.id===activeModule.id?'on':undefined} title={x.name} onClick={()=>switchModule(x.id)}>{x.short}</button>)}
        </div>
      </div></div>}
      <div className="hvac-group"><span className="hvac-group-label">Draw</span><div className="hvac-group-items">
        <IconBtn tip={`Select (${sc('select')})`} active={tool==='select'} onClick={()=>switchTool('select')}><MousePointer2 size={17}/></IconBtn>
        <IconBtn tip={`Draw room — drag for rectangle, click corners for polygon (${sc('draw')})`} active={tool==='draw'} onClick={()=>switchTool('draw')}><PenTool size={17}/></IconBtn>
        <IconBtn tip={`Cutout — drag for rectangle, click corners for polygon (${sc('cutout')})`} active={tool==='cutout'} onClick={()=>switchTool('cutout')}><Scissors size={17}/></IconBtn>
{equipLive&&<>
        <IconBtn tip={`Place equipment — click inside a room (${sc('equip')})`} active={tool==='equip'} onClick={()=>switchTool('equip')}><AirVent size={17}/></IconBtn>
        {tool==='equip'&&<select className="hvac-scale-select" title="Equipment type to place" aria-label="Equipment type to place" value={placeType} onChange={e=>{setPlaceType(e.target.value);e.currentTarget.blur();}}>
          {EQUIP_TYPES.map(t=><option key={t.type}>{t.type}</option>)}</select>}</>}
{fixLive&&<>
        <IconBtn tip={`Place plumbing fixture — R rotates, click inside a room (${sc('fixture')})`} active={tool==='fixture'} onClick={()=>switchTool('fixture')}><Droplets size={17}/></IconBtn>
        {tool==='fixture'&&<select className="hvac-scale-select" title="Fixture to place" aria-label="Fixture to place" value={placeFixType} onChange={e=>{setPlaceFixType(e.target.value);e.currentTarget.blur();}}>
          {fixtureTypes.map(t=><option key={t.id} value={t.id}>{t.tag} · {t.name}</option>)}</select>}</>}
        <IconBtn tip={`15° snap: ${orthogonal?'on':'off'} (${sc('snap')})`} active={orthogonal} onClick={()=>runAction('snap')}><Magnet size={17}/></IconBtn>
        <IconBtn tip="Undo (Ctrl/Cmd+Z)" onClick={undo}><Undo2 size={17}/></IconBtn>
      </div></div>
      <div className="hvac-group"><span className="hvac-group-label">Output</span><div className="hvac-group-items">
        <IconBtn tip={`Room table (${sc('table')})`} active={settings.table.open} onClick={()=>runAction('table')}><LayoutList size={17}/></IconBtn>
        <IconBtn tip="Reports" active={reportsOpen} onClick={()=>{setReportsInitial(undefined);setReportsOpen(true);}}><ClipboardList size={17}/></IconBtn>
        <IconBtn tip="Export all room data to CSV" disabled={!rooms.length} onClick={exportCsv}><Download size={17}/></IconBtn>
      </div></div>
      <div className="hvac-spacer"/>
      <div className="hvac-group hvac-group-end"><span className="hvac-group-label">App</span><div className="hvac-group-items">
        <IconBtn tip="Settings" active={settingsOpen} onClick={()=>openSettings()}><Settings size={17}/></IconBtn>
      </div></div>
    </div>
    <div className="hvac-content">
      <SidePanel side="left" title="Rooms" open={settings.leftOpen} onToggle={()=>setSettings(st=>({...st,leftOpen:!st.leftOpen}))}>
        <div className="hvac-roomlist">
          {rooms.length===0?<p className="hvac-muted">No rooms drawn yet. Press {sc('draw')} to draw one.</p>:rooms.map(r=>{const a=roomArea(r);return <button key={r.id} className={`hvac-room ${selIds.includes(r.id)?'active':''}`} title="Shift- or Ctrl-click to add to the selection" onClick={ev=>{setTool('select');
            if(ev.shiftKey||ev.ctrlKey||ev.metaKey){const ids=selIds.includes(r.id)?selIds.filter(x=>x!==r.id):[...selIds,r.id];setSelection(ids,ids.includes(r.id)?r.id:ids[ids.length-1]??null);}else setSelectedId(r.id);}}><strong>{roomHasIssue(mOf(r))&&<span className="hvac-issue-dot" title="Outdoor air, cooling or heating doesn't meet the requirement"/>}{r.name}</strong><span>{a===null?'Unscaled':`${fmt(a)} SF`}</span></button>;})}
        </div>
        {rooms.length>0&&feetPerPoint!==null&&(()=>{const tot=rooms.reduce((t,r)=>t+(roomArea(r)??0),0);
          const ms=rooms.map(mOf),oa=ms.reduce((t,m)=>t+(m.voz??0),0),prov=ms.reduce((t,m)=>t+m.oa,0);
          if(fixLive){const pt=ms.reduce((t,m)=>({n:t.n+m.plumbing.count,c:t.c+m.plumbing.cold,h:t.h+m.plumbing.hot,w:t.w+m.plumbing.wsfu,d:t.d+m.plumbing.dfu}),{n:0,c:0,h:0,w:0,d:0});
            return <div className="hvac-totals"><div className="hvac-row"><span>Total net area</span><strong>{fmt(tot)} SF</strong></div>
              <div className="hvac-row"><span>Fixtures</span><strong>{fmt(pt.n)}</strong></div>
              <div className="hvac-row"><span>WSFU (cold / hot)</span><strong>{fmtFu(pt.c)} / {fmtFu(pt.h)}</strong></div>
              <div className="hvac-row"><span>Total WSFU</span><strong>{fmtFu(pt.w)}</strong></div>
              <div className="hvac-row"><span>DFU</span><strong>{fmtFu(pt.d)}</strong></div></div>;}
          return <div className="hvac-totals"><div className="hvac-row"><span>Total net area</span><strong>{fmt(tot)} SF</strong></div><div className="hvac-row"><span>Required OA (ΣV<sub>oz</sub>)</span><strong>{fmt(oa)} cfm</strong></div><div className="hvac-row"><span>Provided OA</span><strong className={prov<oa-0.05?'hvac-bad-text':undefined}>{fmt(prov)} cfm</strong></div></div>;})()}
      </SidePanel>
      <div className="hvac-center">
      <main ref={scrollRef} className={`hvac-main${spaceHeld?' pan-ready':''}${panning?' panning':''}`} onWheel={onWheel} onPointerDownCapture={onPanDown} onPointerMoveCapture={onPanMove} onPointerUpCapture={endPan} onPointerCancelCapture={endPan} onAuxClick={e=>e.preventDefault()}>
        {!pdf?<div className="hvac-empty"><FileText size={54} strokeWidth={1.3}/><strong>Start with a floor plan</strong><span>Import a PDF, choose its scale, then trace inside wall faces.</span><button className="hvac-btn primary" onClick={()=>fileRef.current?.click()}>Choose PDF</button></div>:
          <div ref={sheetRef} className="hvac-sheet" style={{width:0,height:0,boxShadow:"none",background:"transparent"}}>
            <div ref={worldRef} className="hvac-world" style={{width:pageSize.width,height:pageSize.height,transform:`translate3d(${offsetRef.current.x}px, ${offsetRef.current.y}px, 0) scale(${zoomRef.current})`,transformOrigin:"0 0",background:"white",boxShadow:"0 6px 26px #64748b35"}}>
              <canvas ref={canvasRef} style={{opacity:settings.pdfOpacity}}/>
              <canvas ref={detailRef} className="hvac-detail" style={{opacity:settings.pdfOpacity}}/>
              <svg ref={svgRef} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`} width={pageSize.width} height={pageSize.height} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onDoubleClick={e=>{if((tool==='draw'||tool==='cutout')&&draftRef.current.length>=3){e.preventDefault();finishRoom();}}} onContextMenu={e=>e.preventDefault()} style={{cursor:tool==='select'?'default':tool==='equip'||tool==='fixture'?'copy':'crosshair'}}>
                <rect data-layer="background" width={pageSize.width} height={pageSize.height} fill="transparent"/>
                {rooms.map(room=><g key={room.id} onPointerDown={e=>startRoomDrag(e,room)} style={{pointerEvents:tool==='select'?'auto':'none'}}>
                  <path d={[room.points,...cutoutsOf(room)].map(ringPath).join('')} fillRule="evenodd" fill={selIds.includes(room.id)?'#3b82f6':'#22c55e'} fillOpacity={!settings.layers.fills?0:room.id === selectedId ? 0.24 : 0.14} stroke={selIds.includes(room.id)?'#2563eb':'#16a34a'} strokeWidth={2/zoom}/>
                  {cutoutsOf(room).map((c,k)=><path key={k} d={ringPath(c)} fill="none" stroke="#dc2626" strokeWidth={1.5/zoom} strokeDasharray={`${5/zoom} ${3/zoom}`} pointerEvents="none"/>)}
                </g>)}
                {tool==='select'&&edgeA&&edgeB&&<g pointerEvents="none">
                  <line x1={edgeA.x} y1={edgeA.y} x2={edgeB.x} y2={edgeB.y} stroke="#f97316" strokeWidth={5/zoom} strokeLinecap="round"/>
                  <circle cx={edgeA.x} cy={edgeA.y} r={4/zoom} fill="#f97316"/><circle cx={edgeB.x} cy={edgeB.y} r={4/zoom} fill="#f97316"/>
                </g>}
                {tool==='select'&&rooms.map(room=>[room.points,...cutoutsOf(room)].map((ring,ri)=>ring.map((a,i)=>{const b=ring[(i+1)%ring.length];
                  const ang=Math.abs(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI)%180,cur=ang<30||ang>150?'ns-resize':ang>60&&ang<120?'ew-resize':ang<90?'nesw-resize':'nwse-resize';
                  return <line key={`${room.id}-${ri}-${i}`} className="hvac-edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10/zoom} strokeLinecap="butt" pointerEvents="stroke"
                    style={{cursor:cur}} onPointerDown={e=>startEdgeDrag(e,room,ri-1,i)}/>;})))}
                {settings.layers.labels&&rooms.map(room=>{const lp=room.labelPos??labelPoint(room),size=room.labelSize??DEFAULT_LABEL_SIZE,a=roomArea(room),sel=room.id===selectedId;
                  const extra=settings.layers.labelValues?activeModule.labelLine(room,mOf(room)):null;
                  return <text key={room.id} ref={el=>{if(el)labelRefs.current.set(room.id,el);else labelRefs.current.delete(room.id);}}
                    className={tool==='select'?'hvac-label':undefined} x={lp.x} y={lp.y} textAnchor="middle"
                    fill={sel?'#1d4ed8':'#1e3a8a'} stroke="white" strokeWidth={size*0.28} paintOrder="stroke" strokeLinejoin="round" fontSize={size} fontWeight="bold"
                    pointerEvents={tool==='select'?'visiblePainted':'none'} onPointerDown={e=>startLabelDrag(e,room,'move')}>
                    <tspan x={lp.x} dy={a!==null?-size*0.15:size*0.35}>{room.name}</tspan>
                    {a!==null&&<tspan x={lp.x} dy={size*1.05} fontSize={size*0.85} fontWeight={600}>{fmt(a)} SF</tspan>}
                    {extra&&<tspan x={lp.x} dy={size*1.0} fontSize={size*0.75} fontWeight={600} fill={extra.bad?'#dc2626':'#0f766e'}>{extra.text}</tspan>}
                  </text>;})}
                {tool==='select'&&labelSel&&selected&&labelBox&&(()=>{const pad=(selected.labelSize??DEFAULT_LABEL_SIZE)*0.25,h=7/zoom;
                  const bx=labelBox.x-pad,by=labelBox.y-pad,bw=labelBox.width+pad*2,bh=labelBox.height+pad*2;
                  return <g>
                    <rect x={bx} y={by} width={bw} height={bh} fill="none" stroke="#f97316" strokeWidth={1.2/zoom} strokeDasharray={`${4/zoom} ${3/zoom}`} pointerEvents="none"/>
                    <rect className="hvac-label-handle" x={bx+bw-h/2} y={by+bh-h/2} width={h} height={h} fill="white" stroke="#f97316" strokeWidth={1.5/zoom} onPointerDown={e=>startLabelDrag(e,selected,'size')}/>
                  </g>;})()}
                {dropTarget&&(()=>{const r=rooms.find(x=>x.id===dropTarget);return r&&r.id!==selectedId?<path d={ringPath(r.points)} fill="#16a34a" fillOpacity={.08} stroke="#16a34a" strokeWidth={3/zoom} strokeDasharray={`${8/zoom} ${5/zoom}`} pointerEvents="none"/>:null;})()}
                {settings.layers.equipment&&rooms.map(room=>room.equipment.map(eq=>{if(!eq.pos)return null;
                  const t=equipType(eq.type),{w,h}=symbolPt(eq),sel=eq.id===selectedEquip,hov=eq.id===hoverEquip,oa=eq.method==='oa';
                  const st=styleOf(eq.type),lost=sel&&dropTarget===null,color=lost?'#dc2626':st.color,stroke=sel?'#f97316':hov?'#f59e0b':color;
                  const fs=Math.max(2.5,Math.min(w,h)*(oa?0.42:0.34)),flow=equipSupply(eq),cap=eq.method==='capacity'?(eq.cools?eq.coolCap:eq.heatCap):null;
                  const sub=cap!==null?`${fmt(Math.round(cap/100)/10)} MBH`:`${fmt(flow)} cfm`;
                  const live=tool==='select'&&equipLive; // other modules show equipment faded and locked
                  return <g key={eq.id} className={live?'hvac-equip-sym':undefined} pointerEvents={live?'all':'none'} opacity={equipLive?1:0.35}
                    onPointerDown={e=>startEquipDrag(e,room,eq)} onPointerEnter={()=>setHoverEquip(eq.id)} onPointerLeave={()=>setHoverEquip(null)}>
                    <rect x={eq.pos.x-w/2} y={eq.pos.y-h/2} width={w} height={h} rx={oa?0:Math.min(w,h)*0.08} fill={color} fillOpacity={Math.min(1,st.opacity+(sel?.12:0))} stroke={stroke} strokeWidth={(sel||hov?2.2:1.3)/zoom}/>
                    {oa&&<path d={`M${eq.pos.x-w/2},${eq.pos.y-h/2}L${eq.pos.x+w/2},${eq.pos.y+h/2}M${eq.pos.x+w/2},${eq.pos.y-h/2}L${eq.pos.x-w/2},${eq.pos.y+h/2}`} stroke={color} strokeWidth={1/zoom} pointerEvents="none"/>}
                    <text x={eq.pos.x} y={oa?eq.pos.y+h/2+fs*1.05:eq.pos.y-fs*0.15} textAnchor="middle" fontSize={fs} fontWeight={700} fill={lost?'#b91c1c':'#0f172a'} stroke="white" strokeWidth={fs*0.25} paintOrder="stroke" pointerEvents="none">
                      {eq.tag||t.prefix}{oa?` · ${sub}`:''}</text>
                    {!oa&&<text x={eq.pos.x} y={eq.pos.y+fs*0.95} textAnchor="middle" fontSize={fs*0.8} fill="#334155" stroke="white" strokeWidth={fs*0.2} paintOrder="stroke" pointerEvents="none">{sub}</text>}
                  </g>;}))}
                {tool==='equip'&&hover&&(()=>{const g={...newEquip(placeType),rot:placeRot%180},{w,h}=symbolPt(g),ok=!!roomAt(hover),c=ok?styleOf(placeType).color:'#dc2626';
                  return <g pointerEvents="none" opacity={.6}><rect x={hover.x-w/2} y={hover.y-h/2} width={w} height={h} fill={c} fillOpacity={.15} stroke={c} strokeWidth={1.5/zoom} strokeDasharray={`${4/zoom} ${3/zoom}`}/>
                    {g.method==='oa'&&<path d={`M${hover.x-w/2},${hover.y-h/2}L${hover.x+w/2},${hover.y+h/2}M${hover.x+w/2},${hover.y-h/2}L${hover.x-w/2},${hover.y+h/2}`} stroke={c} strokeWidth={1/zoom}/>}</g>;})()}
                {settings.layers.fixtures&&rooms.map(room=>(room.fixtures??[]).map(f=>{const t=fixType(f.typeId);if(!t)return null;
                  const sel=f.id===selectedFix,live=tool==='select'&&fixLive,lost=sel&&dropTarget===null,c=lost?'#dc2626':styleOf(FIXTURE_STYLE).color;
                  const w=t.size.w*ptPerFt,h=t.size.h*ptPerFt,ext=(f.rot%180?w:h)/2,fs=Math.max(2.5,Math.min(w,h)*0.3);
                  return <g key={f.id} className={live?'hvac-equip-sym':undefined} pointerEvents={live?'all':'none'} opacity={fixLive?1:0.35}
                    onPointerDown={e=>startFixDrag(e,room,f)}>
                    <g transform={`translate(${f.pos.x} ${f.pos.y}) rotate(${f.rot})`}>
                      <rect x={-w/2} y={-h/2} width={w} height={h} fill="transparent"/>
                      <FixtureSymbol symbol={t.symbol} w={w} h={h} stroke={sel?'#f97316':c} fill={c} fillOpacity={Math.min(1,styleOf(FIXTURE_STYLE).opacity+(sel?.12:0))} sw={(sel?2:1.1)/zoom}/>
                    </g>
                    <text x={f.pos.x} y={f.pos.y+ext+fs*1.05} textAnchor="middle" fontSize={fs} fontWeight={700} fill={lost?'#b91c1c':'#0f172a'} stroke="white" strokeWidth={fs*0.25} paintOrder="stroke" pointerEvents="none">{t.tag}</text>
                  </g>;}))}
                {tool==='fixture'&&hover&&(()=>{const t=fixType(placeFixType);if(!t)return null;const ok=!!roomAt(hover),c=ok?styleOf(FIXTURE_STYLE).color:'#dc2626';
                  return <g pointerEvents="none" opacity={.6} transform={`translate(${hover.x} ${hover.y}) rotate(${placeRot})`}>
                    <FixtureSymbol symbol={t.symbol} w={t.size.w*ptPerFt} h={t.size.h*ptPerFt} stroke={c} fill={c} fillOpacity={.15} sw={1.2/zoom}/></g>;})()}
                {marquee&&(()=>{const win=marquee.b.x>=marquee.a.x,c=win?'#2563eb':'#16a34a';
                  return <rect x={Math.min(marquee.a.x,marquee.b.x)} y={Math.min(marquee.a.y,marquee.b.y)} width={Math.abs(marquee.b.x-marquee.a.x)} height={Math.abs(marquee.b.y-marquee.a.y)}
                    fill={c} fillOpacity={.08} stroke={c} strokeWidth={1/zoom} strokeDasharray={win?undefined:`${5/zoom} ${3/zoom}`} pointerEvents="none"/>;})()}
                {rectPreview&&<polygon points={rectPreview.map(p=>`${p.x},${p.y}`).join(' ')} fill={drawColor} fillOpacity={.12} stroke={drawColor} strokeWidth={2/zoom} strokeDasharray={`${5/zoom} ${4/zoom}`} pointerEvents="none"/>}
                {draft.length>0&&<><polyline points={[...draft,...(previewPoint?[previewPoint]:[])].map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={drawColor} strokeWidth={2/zoom} strokeDasharray={`${6/zoom} ${4/zoom}`} pointerEvents="none"/>{draft.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={(i===0?10:3)/zoom} fill={i===0?'#f59e0b':drawColor} pointerEvents="none"/>)}</>}
                {calPoints.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={5/zoom} fill="#ef4444" pointerEvents="none"/>)}
              </svg>
            </div>
          </div>}
      </main>
      {settings.table.open&&<RoomTable rooms={rooms} metricsOf={mOf} ctx={{tpl:templateName}} saved={settings.reports}
        viewId={settings.table.view??activeModule.report} setViewId={id=>setSettings(st=>({...st,table:{...st.table,view:id===activeModule.report?null:id}}))}
        selIds={selIds} onRowClick={tableRowClick} onEdit={(id,ch)=>{pushHistory();updateRoom(ch,id);}}
        onOpenReports={id=>{setReportsInitial(id);setReportsOpen(true);}} onClose={()=>runAction('table')}
        height={settings.table.height} setHeight={h=>setSettings(st=>({...st,table:{...st.table,height:h}}))} moduleName={activeModule.name}
        following={settings.table.view===null} onFollow={()=>setSettings(st=>({...st,table:{...st.table,view:null}}))}/>}
      </div>
      <SidePanel side="right" title="Properties" open={settings.rightOpen} onToggle={()=>setSettings(st=>({...st,rightOpen:!st.rightOpen}))}>
        <Section title="Drawing" open={secOpen('drawing')} onToggle={()=>toggleSec('drawing')} aside={scale==='custom'?(feetPerPoint?'calibrated':'not calibrated'):scales.find(x=>x[0]===scale)?.[1]}>
          <div className="hvac-row"><span>Scale</span><strong>{scale==='custom'?(feetPerPoint?`${fmt(1/feetPerPoint)} pts / ft`:'Not calibrated'):scales.find(x=>x[0]===scale)?.[1]}</strong></div>
          {pdf&&pdf.numPages>1&&<div className="hvac-row"><span>PDF page</span><select value={pageNumber} onChange={e=>{const next=Number(e.target.value);e.currentTarget.blur();if(next===pageNumber)return;if(rooms.length&&!window.confirm('Switching PDF pages currently clears room takeoffs. Save your project first. Continue?'))return;setPageNumber(next);setRooms([]);setDraft([]);setSelectedId(null);}}>{Array.from({length:pdf.numPages},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></div>}
          {selected&&selIds.length<=1&&<>
            <div className="hvac-subhead">{selected.name}</div>
            <div className="hvac-field"><label>Label size (pt)</label><div className="hvac-inline"><NumField value={selected.labelSize??DEFAULT_LABEL_SIZE} min={2} onChange={v=>updateRoom({labelSize:Math.min(72,v)})}/>
              <button className="hvac-btn" title="Put the label back in its automatic position" disabled={!selected.labelPos} onClick={()=>{pushHistory();updateRoom({labelPos:null});}}>Reset position</button></div></div>
            <div className="hvac-field"><label>Cutouts</label>
              {cutoutsOf(selected).length===0?<div className="hvac-muted">None. Use the Cutout tool ({sc('cutout')}) to remove an area from this room.</div>:
                cutoutsOf(selected).map((c,k)=><div className="hvac-cutout-row" key={k}><span className="hvac-cutout-swatch"/>Cutout {k+1}
                  <strong>{sf(areaPx(c))===null?'—':`−${fmt(sf(areaPx(c))!)} SF`}</strong>
                  <button className="hvac-btn icon-only" title={`Remove cutout ${k+1}`} onClick={()=>deleteCutout(k)}><Trash2 size={13}/></button></div>)}</div>
            {host&&<button className="hvac-btn" style={{width:'100%'}} onClick={()=>cutFromContainer(selected)}><Scissors size={15}/> Cut this room out of {host.name}</button>}
          </>}
          <p className="hvac-muted" style={{marginTop:12}}>Verify the printed scale against a known dimension before relying on areas. Controls and shortcuts are listed in{' '}
            <button className="hvac-linkbtn" style={{padding:0}} onClick={()=>{setSettingsOpen(true);setCaptureNote('');}}>Settings</button>.</p>
        </Section>
        {!selected&&<p className="hvac-muted hvac-pad">Select a room to see its properties. Shift-click or drag a box to select several.</p>}
        {selIds.length>1&&(()=>{const list=rooms.filter(r=>selIds.includes(r.id)),ms=list.map(mOf),tot=ms.reduce((t,m)=>t+(m.area??0),0),eq=list.reduce((t,r)=>t+r.equipment.length,0);
          return <section className="hvac-sec open"><div className="hvac-sec-head" style={{cursor:'default'}}><span>Selection</span><span className="hvac-sec-aside">{list.length} rooms</span></div>
            <div className="hvac-sec-body">
              <div className="hvac-area-card">
                <div><strong>{list.length}</strong><span>Rooms</span></div>
                <div><strong>{feetPerPoint===null?'—':fmt(tot)}</strong><span>Net SF</span></div>
                <div><strong>{eq}</strong><span>Equipment</span></div>
              </div>
              <div className="hvac-sel-list">{list.map(r=><button key={r.id} className="hvac-sel-chip" title="Remove from selection" onClick={()=>{const ids=selIds.filter(x=>x!==r.id);setSelection(ids,ids[ids.length-1]??null);}}>{r.name} <X size={11}/></button>)}</div>
              <p className="hvac-muted">Drag any selected room to move them all, or use the arrow keys (1", Shift 1'-0"). Hold Shift while dragging for a straight move. Esc clears the selection.</p>
              <button className="hvac-btn danger" style={{width:'100%'}} onClick={deleteRoom}><Trash2 size={15}/> Delete {list.length} rooms</button>
            </div></section>;})()}
        {selected&&selectedEdge&&edgeLen!==null&&tool==='select'&&<Section title={selectedEdge.ring<0?'Selected Wall':`Cutout ${selectedEdge.ring+1} Wall`} open={secOpen('wall')} onToggle={()=>toggleSec('wall')}>
          <div className="hvac-row"><span>Length</span><strong>{feetPerPoint===null?`${fmt(edgeLen)} pts`:fmtFeet(edgeLen*feetPerPoint)}</strong></div>
          <p className="hvac-muted">Arrow keys move this wall 1" (Shift: 1'-0"). Neighbouring walls stretch to follow and keep their angles. Esc deselects.</p>
        </Section>}
        {selected&&selIds.length<=1&&(()=>{const m=mOf(selected),net=m.area;
          const tpl=findTemplate(selected.template);
          const tag=(match:boolean)=><div className={`hvac-tpl-tag${tpl&&match?'':' custom'}`}>Template: <strong>{tpl&&match?tpl.name:'Custom'}</strong></div>;
          const cfm=(v:number|null)=>v===null?'—':`${fmt(v)} cfm`;
          const btu=(v:number|null)=>v===null?'—':`${fmt(Math.round(v))} BTU/h`;
          return <>
          <Section title="Room Properties" open={secOpen('room')} onToggle={()=>toggleSec('room')} aside={net===null?undefined:`${fmt(net)} SF`}>
            <div className="hvac-field"><label>Template</label><div className="hvac-inline">
              <select className="hvac-grow" value={tplChoice} onChange={e=>setTplChoice(e.target.value)} aria-label="Room template">
                <option value="">Choose a template…</option>
                <optgroup label="Standard">{BUILTIN_TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                {settings.roomTemplates.length>0&&<optgroup label="My templates">{settings.roomTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              </select>
              <button className="hvac-btn primary" disabled={!tplChoice} title="Apply the template's ventilation, airflow and load values" onClick={()=>applyTemplateTo(selected,tplChoice)}><Check size={14}/> Apply</button>
              {findTemplate(tplChoice)&&!findTemplate(tplChoice)!.builtin&&<button className="hvac-btn icon-only" title="Delete this saved template" onClick={()=>deleteRoomTemplate(tplChoice)}><Trash2 size={13}/></button>}
            </div>
            <button className="hvac-linkbtn" onClick={()=>saveRoomAsTemplate(selected)}>Save this room's settings as a template…</button></div>
            <div className="hvac-field"><label>Name</label><input value={selected.name} onChange={e=>updateRoom({name:e.target.value})}/></div>
            <div className="hvac-field"><label>Ceiling height (ft)</label><NumField value={selected.height} onChange={v=>updateRoom({height:v})}/></div>
            <div className="hvac-area-card">
              <div><strong>{net===null?'—':fmt(net)}</strong><span>Net SF</span></div>
              <div><strong>{m.volume===null?'—':fmt(Math.round(m.volume))}</strong><span>Volume CF</span></div>
              <div><strong>{m.perimeter===null?'—':fmt(m.perimeter)}</strong><span>Perim. LF</span></div>
            </div>
            {net===null?<div className="hvac-area-note">Set or calibrate the drawing scale to calculate areas.</div>
              :cutoutsOf(selected).length>0&&<div className="hvac-area-note">{fmt(m.gross!)} SF gross − {fmt(m.cutouts!)} SF in {cutoutsOf(selected).length} cutout{cutoutsOf(selected).length>1?'s':''}</div>}
            <button className="hvac-btn danger" style={{width:'100%'}} onClick={deleteRoom}><Trash2 size={15}/> Delete Room</button>
          </Section>
          {(()=>{const ctx:ModuleCtx={room:selected,m,tpl,settings,altitudeFt,env,openSettings,openLibrary,addLibToRoom,secOpen,toggleSec,updateRoom,pushHistory,tag,cfm,btu,sc,
            selectedEquip,setSelectedEquip,hoverEquip,setHoverEquip,cardRefs,selectEquip,addEquipTo,removeEquip,updateEquipIn,cloneInto,styleOf,roundUp5,
            fixtureTypes,selectedFix,selectFixture,addFixtureTo,removeFixture,openLibraries:()=>openLibraries('plumbing'),openSchedule:()=>{setReportsInitial('fixture-schedule');setReportsOpen(true);},startPlacing:(typeId:string)=>{setPlaceFixType(typeId);switchTool('fixture');setPlaceFixType(typeId);}};
            return <>
              {activeModule.Sections(ctx)}
              {MODULES.filter(x=>x.id!==activeModule.id).map(x=>{const sm=x.summary(selected,m);
                return <button key={x.id} className="hvac-mod-summary" title={`Switch to ${x.name}`} onClick={()=>switchModule(x.id)}>
                  <span>{x.name}</span><span className={sm.bad?'hvac-bad-text':undefined}>{sm.text}</span><ChevronRight size={14}/></button>;})}
            </>;})()}
          </>;})()}
      </SidePanel>
    </div>
    {libraryOpen!==false&&<Libraries tab={libraryOpen.tab} setTab={tab=>setLibraryOpen({tab,item:null})} onClose={()=>setLibraryOpen(false)}>
      {libraryOpen.tab==='heat'
        ?<EquipmentLibrary library={library} setLibrary={updateLibrary} usage={libUsage} initialId={libraryOpen.item}
          onDeleteItem={deleteLibItem} selectedRoom={selected&&selIds.length<=1?selected.name:null} onAddToRoom={id=>{if(selected)addLibToRoom(selected,id);}}/>
        :<PlumbingLibrary types={fixtureTypes} setTypes={setFixtureTypes} usage={fixUsage} onDeleteType={deleteFixtureType}
          selectedRoom={selected&&selIds.length<=1?selected.name:null} onAddToRoom={id=>{if(selected)addFixtureTo(selected,id);}}/>}
    </Libraries>}
    {reportsOpen&&<Reports rooms={rooms} feetPerPoint={feetPerPoint} env={env} projectName={projectName} saved={settings.reports}
      setSaved={next=>setSettings(st=>({...st,reports:next}))} templateName={templateName} initialId={reportsInitial} onClose={()=>setReportsOpen(false)}/>}
    {settingsOpen&&<div className="hvac-modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget){setSettingsOpen(false);setCapturing(null);}}}>
      <div className="hvac-modal" role="dialog" aria-label="Settings">
        <header><strong>Settings</strong><IconBtn tip="Close (Esc)" onClick={()=>{setSettingsOpen(false);setCapturing(null);}}><X size={17}/></IconBtn></header>
        <Section title="Project" open={secOpen('set-project')} onToggle={()=>toggleSec('set-project')} aside="saved with this project">
          <div className="hvac-grid2">
            <div className="hvac-field"><label>Site altitude (ft)</label><NumField value={altitudeFt} onChange={setAltitudeFt}/></div>
            <div className="hvac-field"><label>People sensible heat (BTU/h per person)</label><NumField value={peopleSensible} onChange={setPeopleSensible}/></div>
          </div>
          <p className="hvac-muted">Altitude corrects the sensible heat factor: {sensibleFactor(altitudeFt).toFixed(3)} BTU/h·cfm·°F (1.08 at sea level). People heat is added to every room's cooling load (ASHRAE: about 245–250 for office work).</p>
        </Section>
        <Section title="Reference data" open={secOpen('set-ref')} onToggle={()=>toggleSec('set-ref')} aside={`${REFERENCE_FILES.reduce((t,f)=>t+verifiedCount(f.data),0)} of ${REFERENCE_FILES.reduce((t,f)=>t+f.data.rows.length,0)} rows verified`}>
          <p className="hvac-muted">Code tables live as JSON files in <code>src/reference/</code>. Check them against the printed tables, mark rows verified, and run <code>node src/reference/check-reference.mjs</code>. See the README in that folder.</p>
          <table className="hvac-ref-table"><tbody>{REFERENCE_FILES.map(f=>{const v=verifiedCount(f.data),n=f.data.rows.length;
            return <tr key={f.file}><td><strong>{f.data.meta.standard} {f.data.meta.edition} {f.data.meta.table}</strong><div className="hvac-muted">{f.file}</div></td>
              <td className={v===n?'hvac-ok-text':'hvac-unverified-text'}>{v}/{n} verified</td></tr>;})}</tbody></table>
          {referenceIssues.length>0&&<div className="hvac-bad-note">{referenceIssues.map((x,i)=><div key={i}>{x}</div>)}</div>}
        </Section>
        <Section title="Keyboard shortcuts" open={secOpen('set-keys')} onToggle={()=>toggleSec('set-keys')}>
          <p className="hvac-muted">Click a key, then press the new key. If it's already in use, the two actions swap keys.</p>
          {ACTIONS.map(a=><div className="hvac-row" key={a.id}><span>{a.label}</span>
            <button className={`hvac-key${capturing===a.id?' capturing':''}`} onClick={()=>{setCapturing(capturing===a.id?null:a.id);setCaptureNote('');}}>{capturing===a.id?'Press a key…':keyLabel(settings.shortcuts[a.id])}</button></div>)}
          {captureNote&&<p className="hvac-note">{captureNote}</p>}
          <button className="hvac-btn" style={{marginTop:10}} onClick={()=>{setSettings(st=>({...st,shortcuts:{...DEFAULT_SHORTCUTS}}));setCapturing(null);setCaptureNote('Shortcuts reset to defaults.');}}>Reset to defaults</button>
        </Section>
        <Section title="Controls" open={secOpen('set-controls')} onToggle={()=>toggleSec('set-controls')}>
          <div className="hvac-fixed">
            <span>Draw ({sc('draw')})</span><span>Drag for a rectangle, or click corners for a polygon. Close by clicking the first corner, double-clicking, or Enter.</span>
            <span>Cutout ({sc('cutout')})</span><span>Same as Draw; the shape is removed from the room it sits in.</span>
            <span>Select ({sc('select')})</span><span>Click a room, label, wall or piece of equipment. Drag a room to move it (with its equipment), a wall to resize, a label or its corner handle to move or resize it. Shift/Ctrl-click adds rooms to the selection. Drag on empty space to box-select: left→right picks rooms fully inside, right→left picks anything the box touches.</span>
            <span>Equipment ({sc('equip')})</span><span>Click inside a room to place. Drag a symbol to move it, even into another room.</span>
            <span>Fixture ({sc('fixture')})</span><span>Plumbing module. Starts with the last fixture used; press it again to cycle through the project's fixtures. R rotates, click inside a room. Drag to move, even into another room.</span>
            <span>Wheel</span><span>Zoom</span>
            <span>{sc('fit')}</span><span>Fit page</span>
          </div>
          <p className="hvac-muted" style={{marginTop:8}}>Trace inside wall faces. Verify the printed scale against a known dimension before relying on areas.</p>
        </Section>
        <Section title="Symbol colors" open={secOpen('set-colors')} onToggle={()=>toggleSec('set-colors')}>
          <p className="hvac-muted">Symbol colour and fill opacity for each equipment type on the plan.</p>
          <div className="hvac-colors">
            {EQUIP_TYPES.map(t=>{const st=styleOf(t.type),set=(ch:Partial<{color:string;opacity:number}>)=>setSettings(x=>({...x,equipStyle:{...x.equipStyle,[t.type]:{...st,...ch}}}));
              return <div className="hvac-color-row" key={t.type}>
                <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true"><rect x="1" y="1" width={t.type===OA_DIFFUSER?16:28} height="16" rx={t.type===OA_DIFFUSER?0:2} fill={st.color} fillOpacity={st.opacity} stroke={st.color} strokeWidth="1.5"/>
                  {t.type===OA_DIFFUSER&&<path d="M1,1L17,17M17,1L1,17" stroke={st.color} strokeWidth="1"/>}</svg>
                <span>{t.type}</span>
                <input type="color" value={st.color} aria-label={`${t.type} colour`} onChange={e=>set({color:e.target.value})}/>
                <input type="range" min={0} max={100} step={5} value={Math.round(st.opacity*100)} aria-label={`${t.type} fill opacity`} onChange={e=>set({opacity:Number(e.target.value)/100})}/>
                <span className="hvac-color-pct">{Math.round(st.opacity*100)}%</span>
              </div>;})}
          </div>
          {(()=>{const st=styleOf(FIXTURE_STYLE),set=(ch:Partial<{color:string;opacity:number}>)=>setSettings(x=>({...x,equipStyle:{...x.equipStyle,[FIXTURE_STYLE]:{...st,...ch}}}));
            return <div className="hvac-colors" style={{marginTop:6}}><div className="hvac-color-row">
              <SymbolPreview symbol="lav" w={2} h={1.6} px={22} color={st.color}/>
              <span>{FIXTURE_STYLE}</span>
              <input type="color" value={st.color} aria-label="Plumbing fixture colour" onChange={e=>set({color:e.target.value})}/>
              <input type="range" min={0} max={100} step={5} value={Math.round(st.opacity*100)} aria-label="Plumbing fixture fill opacity" onChange={e=>set({opacity:Number(e.target.value)/100})}/>
              <span className="hvac-color-pct">{Math.round(st.opacity*100)}%</span></div></div>;})()}
          <button className="hvac-btn" style={{marginTop:10}} disabled={!Object.keys(settings.equipStyle).length} onClick={()=>setSettings(x=>({...x,equipStyle:{}}))}>Reset colors</button>
        </Section>
        <Section title="Fixed keys" open={secOpen('set-fixed')} onToggle={()=>toggleSec('set-fixed')}>
          <div className="hvac-fixed">
            <span>Space + drag</span><span>Pan the drawing</span>
            <span>R</span><span>Rotate the symbol being placed, or the selected fixture / equipment</span>
            <span>Arrows</span><span>Nudge selected equipment, fixture, wall, label or room 1"</span>
            <span>+ / −</span><span>Resize the selected label</span>
            <span>Shift + Arrows</span><span>Nudge 1'-0"</span>
            <span>Enter</span><span>Finish polygon</span>
            <span>Backspace</span><span>Remove last corner / selected cutout</span>
            <span>Delete</span><span>Delete selected equipment, fixture, cutout or room</span>
            <span>Ctrl/Cmd + A</span><span>Select all rooms</span>
            <span>Shift (while dragging)</span><span>Move straight horizontally or vertically</span>
            <span>Ctrl/Cmd + D</span><span>Duplicate selected equipment or fixture</span>
            <span>Ctrl/Cmd + C / V</span><span>Copy equipment or a fixture / paste into the room under the cursor</span>
            <span>Esc</span><span>Cancel drawing, deselect a wall, then clear the selection</span>
            <span>Ctrl/Cmd + Z</span><span>Undo</span>
            <span>Ctrl/Cmd + S</span><span>Save project</span>
          </div>
        </Section>
      </div>
    </div>}
    <footer className="hvac-status">{message} {dirty?" • Unsaved changes (Cmd+S)":""}</footer>
  </div>;
}
