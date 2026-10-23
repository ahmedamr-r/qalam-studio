import { studio, useStudio } from "@/doc/store";
import { topFrameOf } from "@/doc/geometry";
import { ensureYoga } from "@/engine/layout";
import { ensureSystemFonts } from "@/design-system/place";
import { useSystems } from "@/design-system/registry";
import { rebuildInstance, refreshRoot, staleRoots } from "@/design-system/refresh";
import { lintNodes } from "@/lint/rules";

/**
 * Components follow their source live: whenever a design system changes (edited in Assets, by
 * AI, in Tokens), the screens bound to it are refreshed at once. Refreshes stay out of undo
 * history; undoing to an older snapshot makes it stale again, so it's refreshed too.
 */

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function schedule(ms = 60) {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), ms);
}

/** Wait while the designer is mid-gesture or typing: a refresh would pull the layers from under them. */
const busy = () => {
  const s = studio();
  return !!s.txBase || !!s.editingTextId;
};

async function run() {
  if (running) return schedule(120);
  if (!staleRoots(studio().doc).length) return;
  if (busy()) return schedule(300);
  running = true;
  try {
    const systems = new Set(staleRoots(studio().doc).map((id) => studio().doc.nodes[id].meta.designSystem!));
    await Promise.all([ensureYoga(), ...[...systems].map(ensureSystemFonts)]);
    if (busy()) return schedule(300);
    const ids = staleRoots(studio().doc);
    if (!ids.length) return;
    studio().mutate((d) => ids.forEach((id) => refreshRoot(d, id)), { history: false });
    lintNodes(ids);
  } finally {
    running = false;
  }
}

/** Keep screens in step with their design systems (idempotent). */
export function startSystemSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  useSystems.subscribe((s, prev) => {
    if (s.systems !== prev.systems) schedule();
  });
  useStudio.subscribe((s, prev) => {
    if (s.doc !== prev.doc && staleRoots(s.doc).length) schedule();
  });
  schedule(0);
}

/** Designer action: drop an instance's overrides and rebuild it from its component (one undo step). */
export async function resetInstance(id: string) {
  const { doc } = studio();
  const root = topFrameOf(doc, id);
  const dsId = doc.nodes[root]?.meta.designSystem ?? "builtin";
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  studio().mutate((d) => void rebuildInstance(d, id, root, dsId));
  lintNodes([root]);
}
