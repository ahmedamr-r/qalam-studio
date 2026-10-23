import type { Doc } from "@/doc/schema";
import { updateProject } from "@/projects/session";
import { nodeToDataURL } from "./exporter";

/**
 * The home's picture of a Screens project: its first frame at 320px, redrawn a few seconds after
 * edits settle (and at once when the tab is hidden, so leaving shows the latest).
 */

const SIDE = 320;
let timer: ReturnType<typeof setTimeout> | undefined;

function draw(doc: Doc) {
  const id = doc.roots.find((r) => doc.nodes[r]?.type === "frame") ?? doc.roots[0];
  const n = id ? doc.nodes[id] : undefined;
  if (!n) {
    void updateProject({ thumbnail: undefined }, { touch: false });
    return;
  }
  const url = nodeToDataURL(n.id, Math.min(1, SIDE / Math.max(n.w, n.h, 1)));
  if (url) void updateProject({ thumbnail: url }, { touch: false });
}

export function scheduleThumbnail(doc: Doc) {
  clearTimeout(timer);
  if (typeof document !== "undefined" && document.visibilityState === "hidden") draw(doc);
  else timer = setTimeout(() => draw(doc), 5000);
}
