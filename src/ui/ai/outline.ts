import type { Doc } from "@/doc/schema";

/** Compact text outline of a frame for prompts (id · type · name · tokens · text). */
export function outline(doc: Doc, rootId: string): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id];
    if (!n || lines.length > 400) return;
    const bits = [n.id, n.type, JSON.stringify(n.name)];
    if (n.meta.component) bits.push(`[${n.meta.component}]`);
    if (n.fill) bits.push(`fill:${n.fill.token ?? n.fill.color}`);
    if (n.stroke) bits.push(`stroke:${n.stroke.token ?? n.stroke.color}`);
    if (n.radius) bits.push(`radius:${n.radius.token ?? n.radius.tl.rx}`);
    if (n.type === "text") bits.push(`type:${n.text.typeToken ?? `${n.text.fontSize}/${n.text.fontWeight}`} dir:${n.text.direction} "${n.text.content.slice(0, 80)}"`);
    if (n.type === "icon") bits.push(`icon:${n.icon}${n.mirrored ? " mirrored" : ""}`);
    if (n.type === "path") bits.push("vector");
    if (n.type === "frame") bits.push(`dir:${n.dir}`);
    if (n.type === "frame" && n.layout) {
      const L = n.layout;
      const p = L.padding;
      bits.push(`al:${L.direction === "horizontal" ? "h" : "v"}${L.wrap ? " wrap" : ""} gap:${L.justify === "between" ? "auto" : (L.gapToken ?? L.gap)} pad:${[p.top, p.end, p.bottom, p.start].join("/")} align:${L.justify}/${L.align}`);
    }
    if (n.absolute) bits.push("absolute");
    bits.push(`${Math.round(n.w)}×${Math.round(n.h)}`);
    lines.push(`${"  ".repeat(depth)}${bits.join(" · ")}`);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(rootId, 0);
  return lines.join("\n").slice(0, 19000);
}
