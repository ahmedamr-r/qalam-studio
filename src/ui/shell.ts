import type { Doc } from "@/doc/schema";
import type { LeftTab } from "@/doc/store";
import { isGroup } from "@/doc/group-fit";

/*
 * Small pure pieces of the studio shell (status line, left rail, boot fade), kept out of the
 * components so they can be tested without a DOM or the canvas engine.
 */

/** Top-level frames on the canvas: the status line's "N frames". Groups and loose layers don't count. */
export function frameCount(doc: Doc): number {
  let n = 0;
  for (const id of doc.roots) {
    const node = doc.nodes[id];
    if (node?.type === "frame" && !isGroup(node)) n++;
  }
  return n;
}

/**
 * The rail item the nuqta marks: the token editor, component library or Knowledge hub while one is
 * open (it stands in for its panel), else the open panel, else nothing.
 */
export function railMarked(workspace: "tokens" | "components" | "knowledge" | null, open: boolean, tab: LeftTab): LeftTab | null {
  return workspace ?? (open ? tab : null);
}

/**
 * True once the boot gate has lifted (<html data-motion-ready>, set by armMotion). Chrome that
 * mounts after that (⌘\ showing the UI again) must not replay the one-time boot fade.
 */
export function motionArmed(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-motion-ready");
}
