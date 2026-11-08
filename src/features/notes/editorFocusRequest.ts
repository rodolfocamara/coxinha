/** One explicit opening gesture may focus an editor until the user interacts elsewhere. */
export interface EditorFocusRequest {
  focus: (action: () => void) => void;
  cancel: () => void;
}
export function editorFocusRequest(): EditorFocusRequest {
  let pending = true;
  const events = ['pointerdown', 'keydown', 'focusin'] as const;
  const cancel = () => {
    pending = false;
    for (const event of events) document.removeEventListener(event, cancel, true);
  };
  for (const event of events) document.addEventListener(event, cancel, true);
  return {
    cancel,
    focus(action) {
      const allowed = pending;
      cancel();
      if (allowed) action();
    },
  };
}
