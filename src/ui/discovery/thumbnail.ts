import type { Doc } from "@/doc/schema";
import { isOstCard, rootBounds } from "@/doc/board";
import { updateProject } from "@/projects/session";
import { nodeToDataURL } from "../exporter";

/**
 * The home's picture of a Discovery project: its first tree (or the first thing on the board),
 * light whatever the theme, at about 320px, redrawn a few seconds after edits settle.
 */

const SIDE = 320;
let timer: ReturnType<typeof setTimeout> | undefined;

function draw(doc: Doc) {
  const id = doc.roots.find((r) => isOstCard(doc.nodes[r])) ?? doc.roots[0];
  if (!id || !doc.nodes[id]) {
    void updateProject({ thumbnail: undefined }, { touch: false });
    return;
  }
  const b = rootBounds(doc, id);
  const url = nodeToDataURL(id, Math.min(1, SIDE / Math.max(b.w, b.h, 1)));
  if (url) void updateProject({ thumbnail: url }, { touch: false });
}

export function scheduleBoardThumbnail(doc: Doc) {
  clearTimeout(timer);
  if (typeof document !== "undefined" && document.visibilityState === "hidden") draw(doc);
  else timer = setTimeout(() => draw(doc), 4000);
}
