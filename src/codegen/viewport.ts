import type { VNode } from "./states";

/*
 * A phone screen as a viewport (pure): what stays put while its content scrolls. The status bar and
 * the header pin to the top, and the footer and the home indicator to the bottom, as in the apps
 * the screens stand for; the rest scrolls between them. The regions are read from the layers the
 * builders make (buildScreen: Status bar, header instances, Content, Footer, Home indicator) and
 * their spec paths, so screens edited by hand keep pinning as long as those layers are there.
 *
 * On a screen with a hero, the status bar and header sit inside the hero's Backdrop, which scrolls
 * away; they're hoisted into the pinned top, the Backdrop keeps their room as a spacer, and the
 * pinned top overlaps the Backdrop by as much, so nothing moves while nothing has scrolled.
 */

export interface ViewportPlan {
  /** Pinned to the top: the status bar and the header's layers, in order. */
  top: VNode[];
  /** Pinned to the bottom: the footer and the home indicator, in order. */
  bottom: VNode[];
  /** The hero's Backdrop the top was taken from (it keeps a spacer of `hoisted` px), if any. */
  backdrop: VNode | null;
  hoisted: number;
}

const isHeader = (v: VNode) => v.base.meta.specPath?.startsWith("header.") ?? false;
const named = (v: VNode, name: string) => v.base.name === name && v.base.meta.specPath === undefined;
const holdsFooter = (v: VNode): boolean => v.base.meta.specPath?.startsWith("footer.") || v.children.some(holdsFooter);

/** How a phone screen's layers pin, or null when it isn't laid out like one. */
export function viewportPlan(root: VNode): ViewportPlan | null {
  const r = root.base;
  if (r.type !== "frame" || r.layout?.direction !== "vertical" || r.w > 600) return null;
  const kids = root.children;
  let backdrop: VNode | null = null;
  let top: VNode[] = [];
  let i = 0;
  if (kids[0] && named(kids[0], "Backdrop")) {
    backdrop = kids[0];
    const inside = backdrop.children;
    let j = 0;
    if (inside[j] && named(inside[j], "Status bar")) j++;
    while (inside[j] && isHeader(inside[j])) j++;
    top = inside.slice(0, j);
    i = 1;
  } else {
    if (kids[i] && named(kids[i], "Status bar")) i++;
    while (kids[i] && isHeader(kids[i])) i++;
    top = kids.slice(0, i);
  }
  let k = kids.length;
  if (k > i && named(kids[k - 1], "Home indicator")) k--;
  while (k > i && (named(kids[k - 1], "Footer") || holdsFooter(kids[k - 1]))) k--;
  const bottom = kids.slice(k);
  if (!top.length && !bottom.length) return null;
  const hoisted = backdrop ? Math.round(top.reduce((h, v) => h + v.base.h, 0)) : 0;
  return { top, bottom, backdrop: backdrop && top.length ? backdrop : null, hoisted };
}
