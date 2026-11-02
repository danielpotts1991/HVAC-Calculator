import { hvacModule } from './hvac';
import { plumbingModule } from './plumbing';
import type { ModuleDef, ModuleId } from './types';
export type { ModuleCtx, ModuleDef, ModuleId } from './types';

// Order here is the order in the module switcher (the switcher only appears once there are two or more).
// Plumbing is its own module: it takes no values from HVAC.
export const MODULES: ModuleDef[] = [hvacModule, plumbingModule];
export const moduleById = (id: ModuleId) => MODULES.find(m => m.id === id) ?? MODULES[0];
