// Small reusable UI pieces: number field, collapsible sections, side panels, toolbar buttons, meters.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { tidy } from './rooms';

// Numeric input that lets you type freely ("0.", "", "1e") and only commits valid numbers.
export function NumField({ value, onChange, step = 'any', min = 0, disabled, invalid, title }: { value: number; onChange: (v: number) => void; step?: string; min?: number; disabled?: boolean; invalid?: boolean; title?: string }) {
  const [text, setText] = useState(String(tidy(value)));
  const focused = useRef(false);
  // Show outside changes (unit switch, solved value, undo) even while focused, but never
  // overwrite a half-typed entry like "-" or "0." that doesn't parse yet.
  useEffect(() => {
    setText(t => { const n = Number(t); return !focused.current || (t !== '' && Number.isFinite(n) && tidy(n) !== tidy(value)) ? String(tidy(value)) : t; });
  }, [value]);
  return <input type="number" step={step} min={min} disabled={disabled} value={text} className={invalid ? 'bad' : undefined} title={title} aria-invalid={invalid || undefined}
    onFocus={() => { focused.current = true; }}
    onBlur={() => { focused.current = false; setText(String(tidy(value))); }}
    onChange={e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.max(min, n)); }} />;
}
// Collapsible section with a disclosure arrow.
export function Section({ title, open, onToggle, children, aside, nested }: { title: string; open: boolean; onToggle: () => void; children: ReactNode; aside?: ReactNode; nested?: boolean }) {
  return <section className={`hvac-sec${open ? ' open' : ''}${nested ? ' nested' : ''}`}>
    <button className="hvac-sec-head" onClick={onToggle} aria-expanded={open}>
      <ChevronRight size={14} className="hvac-chev" /><span>{title}</span>{aside && <span className="hvac-sec-aside">{aside}</span>}
    </button>
    {open && <div className="hvac-sec-body">{children}</div>}
  </section>;
}
// Side bar that collapses to a thin vertical tab (Bluebeam-style).
export function SidePanel({ side, title, open, onToggle, children }: { side: 'left' | 'right'; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const CloseIcon = side === 'left' ? ChevronsLeft : ChevronsRight;
  if (!open) return <aside className={`hvac-side hvac-side-${side} collapsed`}>
    <button className="hvac-side-tab" onClick={onToggle} title={`Show ${title}`}>{side === 'left' ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}<span>{title}</span></button>
  </aside>;
  return <aside className={`hvac-side hvac-side-${side}`}>
    <div className="hvac-side-head"><span>{title}</span><button className="hvac-btn icon-only" title={`Hide ${title}`} onClick={onToggle}><CloseIcon size={15} /></button></div>
    <div className="hvac-side-body">{children}</div>
  </aside>;
}
// Capacity vs. load bar for the equipment summary.
export function Meter({ label, have, need, short }: { label: string; have: number; need: number | null; short: boolean }) {
  const pct = need && need > 0 ? Math.min(100, Math.max(0, have / need * 100)) : have > 0 ? 100 : 0;
  return <div className="hvac-meter">
    <div className="hvac-meter-top"><span>{label}</span><strong className={short ? 'hvac-bad-text' : undefined}>
      {Math.round(have).toLocaleString()}{need !== null && need > 0 ? ` / ${Math.round(need).toLocaleString()}` : ''} BTU/h</strong></div>
    <div className="hvac-meter-bar"><div className={short ? 'bad' : need && need > 0 ? 'ok' : ''} style={{ width: `${pct}%` }} /></div>
  </div>;
}
// Icon-only toolbar button; its name appears in a tooltip on hover.
export function IconBtn({ tip, active, disabled, onClick, children }: { tip: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={`hvac-btn icon-only${active ? ' active' : ''}`} data-tip={tip} aria-label={tip} disabled={disabled} onClick={onClick}>{children}</button>;
}
