/**
 * F6 / ⇧F6: move keyboard focus between the studio's regions (toolbar, panels, canvas), like
 * Figma. Regions are elements marked `data-region` (in DOM order), else the page landmarks.
 * The canvas region (`main`, or `data-region="canvas"`) gets focus by letting go of it, which
 * hands the keys back to the canvas shortcuts.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function regions(): HTMLElement[] {
  const marked = [...document.querySelectorAll<HTMLElement>("[data-region]")];
  const list = marked.length ? marked : [...document.querySelectorAll<HTMLElement>("header, nav, aside, main")];
  // Only what's on screen and not nested in another region.
  return list.filter((el) => el.getClientRects().length && !list.some((o) => o !== el && o.contains(el)));
}

const isCanvas = (el: HTMLElement) => el.tagName === "MAIN" || el.dataset.region === "canvas";

/** Focus the next (or previous) region. Returns the region's name for feedback. */
export function cycleRegion(dir: 1 | -1): string | null {
  const list = regions();
  if (!list.length) return null;
  const active = document.activeElement as HTMLElement | null;
  const onBody = !active || active === document.body;
  let i = list.findIndex((el) => !onBody && el.contains(active));
  // Nothing focused means the canvas has the keys.
  if (i < 0) i = Math.max(0, list.findIndex(isCanvas));
  const next = list[(i + dir + list.length) % list.length];
  if (isCanvas(next)) {
    active?.blur();
    return "Canvas";
  }
  const target = next.matches(FOCUSABLE) ? next : next.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
  return next.getAttribute("aria-label") ?? next.dataset.region ?? next.tagName.toLowerCase();
}
