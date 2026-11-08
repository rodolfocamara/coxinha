/**
 * Decide whether a click that landed inside the editor surface
 * should *not* steal focus toward the contenteditable.
 *
 * Returns `true` when the click hit an interactive element that
 * already does the right thing (the editor itself, a header
 * button, a tag chip wrapped in a button, a link, a form input).
 * Returns `false` when the click landed on dead padded space
 * around the reading column — in which case the caller should
 * forward focus to the editor.
 */
export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  return !!target.closest(
    '[contenteditable="true"], button, a, input, textarea, select, [role="button"], [role="link"]'
  );
}
