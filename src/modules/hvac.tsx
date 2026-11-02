// HVAC module: ASHRAE ventilation -> internal loads -> mechanical equipment, in that order,
// because each step feeds the next (outdoor air and cooling load size the equipment).
import { fmt } from '../rooms';
import type { ModuleCtx, ModuleDef } from './types';
import { VentilationSections } from './ventilation';
import { MechanicalSections } from './mechanical';

function HvacSections(ctx: ModuleCtx) {
  return <>{VentilationSections(ctx)}{MechanicalSections(ctx)}</>;
}

export const hvacModule: ModuleDef = {
  id: 'hvac', name: 'HVAC', short: 'HVAC', report: 'roomdata',
  Sections: HvacSections,
  summary: (r, m) => ({
    text: `${m.voz === null ? '—' : fmt(m.voz)} cfm OA req. · ${r.equipment.length} unit${r.equipment.length === 1 ? '' : 's'}`,
    bad: m.oaShort || m.coolingShort || m.heatingShort,
  }),
  labelLine: (r, m) => {
    const parts = [m.voz === null ? '' : `OA ${fmt(m.oa)}/${fmt(m.voz)}`, r.equipment.length ? `${fmt(m.supply)} cfm` : ''].filter(Boolean);
    return parts.length ? { text: parts.join(' · '), bad: m.oaShort || m.coolingShort || m.heatingShort } : null;
  },
};
