/**
 * One probe per entry of `src/lib/shortcuts/table.ts`, keyed by id. `shortcuts.mjs`
 * calls each probe once per chord of its entry, and `t.press()` sends that chord,
 * so changing a key in the table changes what is pressed here. A new entry with no
 * probe fails `contract.test.ts` and the run.
 */
import { appProbes } from './probes/appProbes.mjs';
import { calendarProbes } from './probes/calendarProbes.mjs';
import { layerProbes } from './probes/layerProbes.mjs';
import { systemProbes } from './probes/systemProbes.mjs';
import { workspaceProbes } from './probes/workspaceProbes.mjs';

export const PROBES = {
  ...systemProbes,
  ...appProbes,
  ...workspaceProbes,
  ...calendarProbes,
  ...layerProbes,
};
