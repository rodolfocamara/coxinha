import { appearanceStylesheet } from './stylesheet';
import {
  APPEARANCE_CSS_KEY,
  APPEARANCE_STORAGE_KEY,
  readAppearance,
  sanitize,
  type Appearance,
} from './settings';

export * from './settings';
export { rem, remScale } from './units';

export const APPEARANCE_ELEMENT_ID = 'cx-appearance';
/** Layout changed under measured things (sliding indicators). */
export const APPEARANCE_APPLIED_EVENT = 'coxinha:appearance-applied';

export function applyAppearance(a: Appearance = readAppearance()): void {
  const css = appearanceStylesheet(a);
  let style = document.getElementById(APPEARANCE_ELEMENT_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = APPEARANCE_ELEMENT_ID;
  }
  // Last in <head>, so it follows the app's stylesheets as they load.
  document.head.append(style);
  style.textContent = css;
  try {
    if (css) localStorage.setItem(APPEARANCE_CSS_KEY, css);
    else localStorage.removeItem(APPEARANCE_CSS_KEY);
  } catch {
    /* Restricted storage: the setting still applies to this session. */
  }
  window.dispatchEvent(new Event(APPEARANCE_APPLIED_EVENT));
}

export function saveAppearance(change: Partial<Appearance>): Appearance {
  const next = sanitize({ ...readAppearance(), ...change });
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Restricted storage: the setting still applies to this session. */
  }
  applyAppearance(next);
  return next;
}
