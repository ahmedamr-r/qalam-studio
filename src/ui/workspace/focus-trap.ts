/**
 * Keeps Tab inside the workspace while it is a modal. Only the two edges are handled: Tab on the
 * last stop goes to the first and ⇧Tab on the first goes to the last; everything in between keeps
 * the browser's own order, so roving groups and scrollers still behave natively.
 */

const TABBABLE =
  ':is(button, input, select, textarea, a[href], [contenteditable=""], [contenteditable="true"], [tabindex]):not([disabled], [tabindex="-1"])';

/** The keyboard stops inside `root`, in document order: rendered, enabled, not inert. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

/**
 * Where Tab has to send focus to stay inside: the stop to focus, or null when the browser's own move
 * already stays inside. `index` is -1 when focus is on the container itself, or on something that is
 * not one of its stops (a scroller, a popover portalled out of it), which wraps either way.
 */
export function wrapTab(count: number, index: number, back: boolean): number | null {
  if (count === 0) return null;
  if (back) return index <= 0 ? count - 1 : null;
  return index === -1 || index === count - 1 ? 0 : null;
}

/** Keydown handler body: wraps Tab at the edges of `root`. Returns true when it moved focus. */
export function trapTab(e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, root: HTMLElement): boolean {
  if (e.key !== "Tab") return false;
  const stops = tabbables(root);
  if (!stops.length) {
    // Nothing to land on: stay on the container rather than walk out of it.
    e.preventDefault();
    return true;
  }
  const next = wrapTab(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  if (next === null) return false;
  e.preventDefault();
  stops[next].focus();
  return true;
}
