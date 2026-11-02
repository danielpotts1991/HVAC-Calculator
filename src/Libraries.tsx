// Libraries window: one place for every kind of reusable project equipment, one tab per category.
// Add a future category by adding a tab here and a component for its contents.
import type { ReactNode } from 'react';
import { X, Package, Droplets } from 'lucide-react';

export type LibTab = 'heat' | 'plumbing';
const TABS: { id: LibTab; label: string; icon: ReactNode }[] = [
  { id: 'heat', label: 'Heat-generating equipment', icon: <Package size={15} /> },
  { id: 'plumbing', label: 'Plumbing fixtures', icon: <Droplets size={15} /> },
];

export default function Libraries({ tab, setTab, onClose, children }: { tab: LibTab; setTab: (t: LibTab) => void; onClose: () => void; children: ReactNode }) {
  return <div className="hvac-reports hvac-library" role="dialog" aria-label="Libraries">
    <div className="hvac-reports-bar">
      <strong>Libraries</strong>
      <div className="hvac-lib-tabs" role="tablist">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'on' : undefined} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>)}
      </div>
      <div className="hvac-reports-actions"><button className="hvac-btn icon-only" title="Close (Esc)" onClick={onClose}><X size={17} /></button></div>
    </div>
    {children}
  </div>;
}
