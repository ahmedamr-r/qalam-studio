/**
 * What keeps the Components page read-only (pure): a doc pass that undoes edits to its drawings,
 * and the command guard that leaves only looking around.
 */
import type { DocPass } from "@/doc/store";
import { COMPONENTS_PAGE, isShowcase, screensPage } from "@/doc/pages";
import type { Doc } from "@/doc/schema";
import type { Command } from "@/commands/registry";

export const COMPONENTS_READ_ONLY = "The Components page shows the design system: change components in Assets or Tokens";

/**
 * Anything that reaches the page's drawings is undone; new top-level layers go to the page it
 * was opened from (in the same undo step). Showing another page isn't checked.
 */
export const componentsPass: DocPass = (prev, next) => {
  if (next.page !== COMPONENTS_PAGE || prev.page !== COMPONENTS_PAGE) return next;
  if (prev.nodes === next.nodes && prev.roots === next.roots) return next;
  const drawn = new Set<string>();
  const add = (d: Doc, id: string) => {
    if (drawn.has(id) || !d.nodes[id]) return;
    drawn.add(id);
    d.nodes[id].children.forEach((c) => add(d, c));
  };
  const shown = prev.roots.filter((id) => isShowcase(prev.nodes[id]));
  shown.forEach((id) => add(prev, id));
  let nodes: Doc["nodes"] | null = null;
  const fix = () => (nodes ??= { ...next.nodes });
  for (const id of drawn) if (next.nodes[id] !== prev.nodes[id]) fix()[id] = prev.nodes[id];
  // Layers added inside the drawings go.
  for (const id of Object.keys(next.nodes)) {
    if (prev.nodes[id] || drawn.has(id)) continue;
    let top = next.nodes[id];
    while (top?.parentId) top = next.nodes[top.parentId];
    if (top && drawn.has(top.id)) delete fix()[id];
  }
  const added = next.roots.filter((id) => !drawn.has(id) && next.nodes[id]);
  const rootsChanged = added.length || shown.length !== next.roots.length - added.length || shown.some((id, i) => next.roots[i] !== id);
  if (!nodes && !rootsChanged) return next;
  const out: Doc = { ...next, nodes: nodes ?? next.nodes, roots: shown };
  if (added.length) {
    const back = screensPage(next);
    out.pages = (next.pages ?? []).map((p) => (p.id === back ? { ...p, roots: [...p.roots, ...added.filter((id) => !p.roots.includes(id))] } : p));
  }
  return out;
};

/** Commands that still run on the page: looking around, pages, panels, undo, exporting what's selected. */
const ALLOWED_CATEGORIES = new Set(["zoom", "view", "panels", "essential", "ai"]);
const ALLOWED_IDS = new Set(["edit.undo", "edit.redo", "select.none", "tool.select", "tool.hand", "edit.copy-png", "edit.export", "file.export-json", "file.open"]);

export const componentsGuard = (c: Pick<Command, "id" | "category">): string | null => (ALLOWED_CATEGORIES.has(c.category) || ALLOWED_IDS.has(c.id) || c.id.startsWith("page.") ? null : COMPONENTS_READ_ONLY);

