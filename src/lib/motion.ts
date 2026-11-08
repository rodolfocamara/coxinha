/**
 * Motion helpers (spec 0096). The new state always renders at once; a view
 * transition only animates where things went. Without engine support or with
 * reduced motion the update runs synchronously and nothing else happens.
 *
 * Kinds map to CSS in `src/styles/motion.css`:
 * - `nav`: crossing screens, 200ms rise.
 * - `zoom` / `zoomout`: Hoje <-> Workspace, around `--zx`/`--zy`.
 * - `local`: in-place edits (editor slide, card morphs).
 */
export type TransitionKind = 'nav' | 'zoom' | 'zoomout' | 'local';

type ViewTransitionLike = { finished: Promise<void> };
type DocumentWithTransitions = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

let sequence = 0;
const temporaryNames: HTMLElement[] = [];

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function canAnimateTransitions() {
  const doc = document as DocumentWithTransitions;
  return typeof doc.startViewTransition === 'function' && !prefersReducedMotion();
}

/** Gives an element a view-transition-name until the current transition ends. */
export function nameForTransition(element: Element | null | undefined, name: string) {
  if (!(element instanceof HTMLElement)) return;
  element.style.viewTransitionName = name;
  temporaryNames.push(element);
}

function clearTemporaryNames() {
  while (temporaryNames.length) temporaryNames.pop()!.style.viewTransitionName = '';
}

/** Sets the zoom origin to the centre of `element`, relative to the main view. */
export function setZoomOrigin(element: Element | null | undefined) {
  const view = document.querySelector('[data-shell-view]');
  if (!element || !view) return;
  const v = view.getBoundingClientRect();
  const r = element.getBoundingClientRect();
  const root = document.documentElement.style;
  root.setProperty('--zx', `${r.left + r.width / 2 - v.left}px`);
  root.setProperty('--zy', `${r.top + r.height / 2 - v.top}px`);
}

export function runTransition(kind: TransitionKind, update: () => void | Promise<void>) {
  const doc = document as DocumentWithTransitions;
  if (!canAnimateTransitions()) {
    const result = update();
    clearTemporaryNames();
    return Promise.resolve(result);
  }
  trackTransitions();
  document.documentElement.dataset.vt = kind;
  return doc.startViewTransition!(update).finished.catch(() => undefined);
}

let tracking = false;
/**
 * Router-driven transitions (TanStack `viewTransition: true`) do not expose
 * their `finished` promise, so the document method is wrapped once to clear
 * `data-vt` and temporary names when the latest transition ends.
 */
function trackTransitions() {
  const doc = document as DocumentWithTransitions;
  if (tracking || typeof doc.startViewTransition !== 'function') return;
  tracking = true;
  const original = doc.startViewTransition.bind(doc);
  doc.startViewTransition = ((update: () => void | Promise<void>) => {
    const transition = original(update);
    const mine = ++sequence;
    transition.finished
      .finally(() => {
        if (mine === sequence) {
          delete document.documentElement.dataset.vt;
          clearTemporaryNames();
        }
      })
      .catch(() => undefined);
    return transition;
  }) as DocumentWithTransitions['startViewTransition'];
}

/**
 * Prepares a router navigation to run as a view transition of `kind`.
 * Returns the value for TanStack's `viewTransition` navigate option.
 */
export function prepareRouteTransition(kind: TransitionKind) {
  if (!canAnimateTransitions()) {
    clearTemporaryNames();
    return false;
  }
  trackTransitions();
  document.documentElement.dataset.vt = kind;
  return true;
}
