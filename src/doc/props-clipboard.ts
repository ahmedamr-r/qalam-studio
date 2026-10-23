import type { Effect, Paint, Radius, SceneNode, Stroke, TextProps } from "./schema";
import { studio } from "./store";
import { cloneNode } from "./factory";
import { fitText } from "./ops";

/**
 * Copy / paste properties (⌥⌘C / ⌥⌘V): a layer's look, without its content or geometry. Paste
 * applies what each target supports: type styles only to text, corners only where they draw.
 */

export interface Props {
  fill: Paint | null;
  stroke: Stroke | null;
  radius: Radius | null;
  effects?: Effect[];
  shadowToken?: string;
  opacity: number;
  /** Text layers: the type style (not the words, alignment or sizing). */
  text?: Pick<TextProps, "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing" | "typeToken" | "decoration" | "italic">;
}

let copied: Props | null = null;

export const hasProps = () => !!copied;

/** The properties of one layer, as a detached copy. */
export function propsOf(n: SceneNode): Props {
  const c = cloneNode(n);
  const p: Props = { fill: c.fill, stroke: c.stroke, radius: c.radius, opacity: c.opacity };
  if (c.effects) p.effects = c.effects;
  if (c.shadowToken) p.shadowToken = c.shadowToken;
  if (c.type === "text") {
    const { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, typeToken, decoration, italic } = c.text;
    p.text = { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, typeToken, decoration, italic };
  }
  return p;
}

/** Layers that draw a rounded box. */
const hasCorners = (n: SceneNode) => n.type === "frame" || n.type === "rect" || n.type === "image";

/** Apply copied properties to one layer (mutates; call inside a recipe). */
export function applyProps(n: SceneNode, p: Props) {
  const c = JSON.parse(JSON.stringify(p)) as Props;
  // Text and icons draw with their fill: never take it away from them.
  if (c.fill || (n.type !== "text" && n.type !== "icon")) n.fill = c.fill;
  if (n.type !== "text" && n.type !== "icon") n.stroke = c.stroke;
  if (hasCorners(n)) n.radius = c.radius;
  if (n.type !== "text" && n.type !== "icon" && n.type !== "path") {
    if (c.effects) n.effects = c.effects;
    else delete n.effects;
    if (c.shadowToken) n.shadowToken = c.shadowToken;
    else delete n.shadowToken;
  }
  n.opacity = c.opacity;
  if (n.type === "text" && c.text) {
    n.text = { ...n.text, ...c.text };
    if (!c.text.decoration) delete n.text.decoration;
    if (!c.text.italic) delete n.text.italic;
    if (!c.text.typeToken) delete n.text.typeToken;
    fitText(n);
  }
}

/** ⌥⌘C: remember the first selected layer's properties. */
export function copyProps(ids: string[]): boolean {
  const n = ids.map((id) => studio().doc.nodes[id]).find(Boolean);
  if (!n) return false;
  copied = propsOf(n);
  return true;
}

/** ⌥⌘V: paste them onto every unlocked selected layer, in one undo step. Returns how many changed. */
export function pasteProps(ids: string[]): number {
  const p = copied;
  if (!p) return 0;
  const doc = studio().doc;
  const targets = ids.filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
  if (!targets.length) return 0;
  studio().mutate((d) => {
    for (const id of targets) applyProps(d.nodes[id], p);
  });
  return targets.length;
}
