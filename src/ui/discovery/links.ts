import type { MouseEvent } from "react";
import { flushDoc } from "@/projects/session";

/**
 * A link to another project, in the same tab: this project's document saves first (a page load
 * can cut a save short). ⌘-, Ctrl- or Shift-click still opens it in a new tab or window.
 */
export function saveThenGo(e: MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const href = e.currentTarget.href;
  void flushDoc().then(() => window.location.assign(href));
}
