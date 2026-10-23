import { nanoid } from "nanoid";
import type { TokenSet } from "@/design-system/resolve";
import { activeTokens } from "@/design-system/registry";
import type {
  FrameNode,
  IconNode,
  ImageNode,
  NodeMeta,
  PathNode,
  SceneNode,
  ShapeNode,
  TextNode,
  TextProps,
} from "./schema";
import { uniformRadius } from "./schema";

export const newId = () => nanoid(10);

const base = (meta?: Partial<NodeMeta>) => ({
  id: newId(),
  parentId: null as string | null,
  children: [] as string[],
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  stroke: null,
  meta: { source: "user" as const, ...meta },
});

export function makeFrame(p: Partial<FrameNode> = {}, ts: TokenSet = activeTokens()): FrameNode {
  return {
    ...base(p.meta),
    type: "frame",
    name: "Frame",
    x: 0,
    y: 0,
    w: 390,
    h: 844,
    fill: { color: ts.color("bg.canvas")!, token: "bg.canvas" },
    radius: uniformRadius(0),
    clip: true,
    dir: "ltr",
    ...p,
  } as FrameNode;
}

export function makeShape(type: "rect" | "ellipse", p: Partial<ShapeNode> = {}, ts: TokenSet = activeTokens()): ShapeNode {
  return {
    ...base(p.meta),
    type,
    name: type === "rect" ? "Rectangle" : "Ellipse",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    fill: { color: ts.color("bg.surface")!, token: "bg.surface" },
    radius: type === "rect" ? uniformRadius(0) : null,
    ...p,
  } as ShapeNode;
}

export function makePath(d: string, p: Partial<PathNode> = {}, ts: TokenSet = activeTokens()): PathNode {
  return {
    ...base(p.meta),
    type: "path",
    name: "Vector",
    d,
    vw: 24,
    vh: 24,
    x: 0,
    y: 0,
    w: 24,
    h: 24,
    fill: { color: ts.color("icon.primary")!, token: "icon.primary" },
    radius: null,
    ...p,
  } as PathNode;
}

export function defaultTextProps(typeToken = "type.body", ts: TokenSet = activeTokens()): TextProps {
  const t = ts.typography(typeToken) ?? ts.typography("type.body")!;
  return {
    content: "Text",
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    align: "start",
    direction: "auto",
    autoSize: "width",
    typeToken,
  };
}

export function makeText(p: Omit<Partial<TextNode>, "text"> & { text?: Partial<TextProps> } = {}, ts: TokenSet = activeTokens()): TextNode {
  const { text, ...rest } = p;
  return {
    ...base(p.meta),
    type: "text",
    name: text?.content?.slice(0, 32) || "Text",
    x: 0,
    y: 0,
    w: 40,
    h: 22,
    fill: { color: ts.color("text.primary")!, token: "text.primary" },
    radius: null,
    ...rest,
    text: { ...defaultTextProps(text?.typeToken, ts), ...text },
  } as TextNode;
}

export function makeIcon(icon: string, p: Partial<IconNode> = {}, ts: TokenSet = activeTokens()): IconNode {
  return {
    ...base(p.meta),
    type: "icon",
    name: icon,
    icon,
    x: 0,
    y: 0,
    w: 24,
    h: 24,
    strokeWidth: 2,
    mirrored: false,
    fill: { color: ts.color("icon.primary")!, token: "icon.primary" },
    radius: null,
    ...p,
  } as IconNode;
}

export function makeImage(src: string, p: Partial<ImageNode> = {}): ImageNode {
  return {
    ...base(p.meta),
    type: "image",
    name: "Image",
    src,
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    fill: null,
    radius: uniformRadius(0),
    ...p,
  } as ImageNode;
}

export function cloneNode<T extends SceneNode>(n: T): T {
  return JSON.parse(JSON.stringify(n)) as T;
}
