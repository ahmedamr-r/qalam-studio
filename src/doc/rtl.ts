import type { Doc, FrameNode, SceneNode } from "./schema";
import { studio } from "./store";
import { cloneNode, newId } from "./factory";
import { isDirectional } from "@/design-system/icons";
import { freeSlotRight } from "./geometry";

/** Mirror a subtree horizontally in place (positions, corners, directional icons, text direction). */
export function mirrorSubtree(d: Doc, id: string, toDir: "ltr" | "rtl") {
  const n = d.nodes[id];
  if (n.type === "frame") (n as FrameNode).dir = toDir;
  for (const cid of n.children) {
    const c = d.nodes[cid];
    c.x = n.w - c.x - c.w;
    c.rotation = -c.rotation;
    mirrorNode(c, toDir);
    mirrorSubtree(d, cid, toDir);
  }
}

function mirrorNode(c: SceneNode, toDir: "ltr" | "rtl") {
  if (c.radius) {
    const r = c.radius;
    [r.tl, r.tr] = [r.tr, r.tl];
    [r.bl, r.br] = [r.br, r.bl];
  }
  if (c.type === "text" && c.text.direction !== "auto") c.text.direction = toDir;
  if (c.type === "icon" && isDirectional(c.icon)) c.mirrored = toDir === "rtl";
}

/** Duplicate a frame next to itself with the layout mirrored for the opposite direction. */
export function mirrorForRTL(frameId: string) {
  const s = studio();
  const src = s.doc.nodes[frameId] as FrameNode | undefined;
  if (!src || src.type !== "frame") return;
  const toDir = src.dir === "rtl" ? "ltr" : "rtl";
  let createdId = "";
  s.mutate((d) => {
    const copy = (sid: string, parentId: string | null): string => {
      const c = cloneNode(d.nodes[sid]);
      c.id = newId();
      c.parentId = parentId;
      c.children = d.nodes[sid].children.map((ch) => copy(ch, c.id));
      d.nodes[c.id] = c;
      return c.id;
    };
    createdId = copy(frameId, src.parentId);
    const f = d.nodes[createdId];
    f.name = `${src.name.replace(/ · (RTL|LTR)$/, "")} · ${toDir.toUpperCase()}`;
    if (!src.parentId) f.x = freeSlotRight(d, { x: src.x, y: src.y, w: src.w, h: src.h }, 80, createdId);
    else f.x += 16;
    const list = src.parentId ? d.nodes[src.parentId].children : d.roots;
    list.splice(list.indexOf(frameId) + 1, 0, createdId);
    mirrorSubtree(d, createdId, toDir);
  });
  s.select([createdId]);
}
