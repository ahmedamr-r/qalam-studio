import type { KnowledgeControls } from "@/knowledge/types";
import type { ShapeRecipe } from "./shape-recipe";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import type { NoteMeta, OstCard, ServesMeta } from "@/discovery/types";

export type NodeType = "frame" | "rect" | "ellipse" | "text" | "icon" | "image" | "path";

export interface Corner {
  rx: number;
  ry: number;
}

export interface Radius {
  /** All four corners share one value. */
  linked: boolean;
  /** rx === ry on every corner (circular). When false, corners are elliptical. */
  circular: boolean;
  tl: Corner;
  tr: Corner;
  br: Corner;
  bl: Corner;
  token?: string;
}

export interface GradientStop {
  color: string;
  /** 0–1 along the gradient line */
  position: number;
}

export interface Gradient {
  kind: "linear" | "radial";
  /** CSS convention: 0deg points up, 90deg points right. Ignored for radial. */
  angle: number;
  stops: GradientStop[];
}

export interface Paint {
  /** #RRGGBB or #RRGGBBAA. For gradients, a representative flat colour used for contrast checks. */
  color: string;
  token?: string;
  gradient?: Gradient;
}

export interface Stroke extends Paint {
  width: number;
  widthToken?: string;
  /** Dash and gap lengths in px, repeating (paths only for now). Absent = solid. */
  dash?: number[];
}

/** One shadow layer, as drawn. Resolved from a shadow token and stored on the node. */
export interface Effect {
  kind: "drop" | "inner";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export type FlagSeverity = "error" | "warning" | "info";

export interface Flag {
  rule: string;
  severity: FlagSeverity;
  message: string;
}

export interface NodeMeta {
  /** Design-system component this node was built from, e.g. "Button/Primary". */
  component?: string;
  source: "user" | "ai" | "import";
  flags?: Flag[];
  interactive?: boolean;
  /** Minimum hit area (px) when the touch target is larger than the visual, e.g. 36px chips with a 44px target. */
  hitArea?: number;
  /** Layout token bindings recorded by builders (padding/gap) so the linter can check them. */
  spaceTokens?: string[];
  /** Root frames: the design system the screen is bound to (defaults to the built-in one). */
  designSystem?: string;
  /** Root frames built from a catalog spec keep it, so they can be rebuilt in another system. */
  spec?: ScreenSpec;
  /** Structure of the tree right after building; a mismatch means it was edited by hand. */
  specFingerprint?: string;
  /** Catalog instances: where the instance sits in the root's spec, e.g. "body.2.children.0". */
  specPath?: string;
  /** Instances placed on their own (not part of a screen's spec): the instance they were built from. */
  inst?: Inst;
  /** Instances: fingerprint of what the designer can override, taken when built (see design-system/instances.ts). */
  instFingerprint?: string;
  /** Roots: the version (updatedAt) of their design system they were last built or refreshed with. */
  systemVersion?: number;
  /** Frames: a group (⌘G). No fill, stroke, clip or layout; its box always hugs its children (see doc/group.ts). */
  group?: boolean;
  /** Groups: a mask group (⌃⌘M). Its first (bottom-most) child masks the others by its alpha (see doc/mask.ts). */
  mask?: boolean;
  /** Discovery: a card of the opportunity tree, painted from this data; its children are its child cards (see src/discovery). */
  ost?: OstCard;
  /** Discovery: a free note on the board (a sticky). */
  note?: NoteMeta;
  /** Screens projects: a root designed for a Discovery solution ("Design this"). */
  serves?: ServesMeta;
  /** The Components page: a section, card or variant cell drawn from the design system (read-only, never saved). */
  showcase?: ShowcaseMeta;
}

/** What a node of the Components page shows (see design-system/showcase.ts). */
export interface ShowcaseMeta {
  kind: "section" | "card" | "cell";
  /** Sections: the group's label ("Navigation", "<System> components"). */
  group?: string;
  /** Cards and cells: the catalog component, or the system's own component's name. */
  component?: string;
  /** The system's own component (a pattern), not a catalog one. */
  own?: boolean;
  /** Cells: the option this cell shows ("variant" = "secondary"); absent for a lone default cell. */
  prop?: string;
  value?: string;
  /** Sections: the system build they were drawn from ("<id>@<updatedAt>"). */
  sig?: string;
}

export interface TextProps {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** px */
  lineHeight: number;
  letterSpacing: number;
  align: "start" | "center" | "end" | "justify";
  direction: "auto" | "ltr" | "rtl";
  /** ⌘U / ⇧⌘X. Absent = none. */
  decoration?: "underline" | "strikethrough";
  /** ⌘I. Bundled families have no italic files: the renderer slants the upright ones. */
  italic?: boolean;
  /** width = grow horizontally, height = fixed width / grow vertically, fixed = both fixed */
  autoSize: "width" | "height" | "fixed";
  maxLines?: number;
  typeToken?: string;
}

/** How a node sizes on one axis inside auto layout (Figma: fixed, hug contents, fill container). */
export type Sizing = "fixed" | "hug" | "fill";

export type LogicalEdge = "top" | "end" | "bottom" | "start";

/** Figma-style auto layout on a frame. Children are placed by the layout engine (src/doc/autolayout.ts). */
export interface AutoLayout {
  direction: "horizontal" | "vertical";
  /** Horizontal layouts: flow onto new lines when out of room. */
  wrap: boolean;
  /** Space between items on the main axis. */
  gap: number;
  /** Space between wrapped lines. */
  crossGap: number;
  /** Logical padding: start/end follow the frame's `dir`, so switching direction mirrors it. */
  padding: Record<LogicalEdge, number>;
  /** Main-axis distribution; "between" is Figma's "Auto" spacing (the numeric gap is kept). */
  justify: "start" | "center" | "end" | "between";
  /** Cross-axis alignment. */
  align: "start" | "center" | "end";
  gapToken?: string;
  crossGapToken?: string;
  paddingTokens?: Partial<Record<LogicalEdge, string>>;
}

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  children: string[];
  /** Position relative to the parent's top-left corner (pre-rotation). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Auto layout sizing per axis; absent = fixed (text falls back to its autoSize). Fill only applies inside auto layout. */
  sizeH?: Sizing;
  sizeV?: Sizing;
  /** Inside an auto-layout parent: keep x/y instead of joining the flow ("Ignore auto layout"). */
  absolute?: boolean;
  /** With absolute: pinned to all four edges of its parent, so it's always the parent's size (a backdrop, a composed shape). */
  fillParent?: boolean;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  /** Width ÷ height kept by auto layout while the node hugs on one axis (pictures keep their shape at any width). */
  aspect?: number;
  /** Main-axis flex weight (builders: grow, progress bars); shown as Fill. */
  grow?: number;
  /** Logical margins from the component builders (e.g. a full-bleed map); not editable in the panel. */
  margin?: Partial<Record<LogicalEdge, number>>;
  /** Degrees, clockwise, around the node centre. */
  rotation: number;
  /** Mirrored across the node's vertical (flipH) or horizontal (flipV) centre line, before rotating (⇧H / ⇧V). */
  flipH?: boolean;
  flipV?: boolean;
  opacity: number;
  visible: boolean;
  locked: boolean;
  fill: Paint | null;
  stroke: Stroke | null;
  radius: Radius | null;
  /** Shadow token binding; the resolved layers live in `effects`. */
  shadowToken?: string;
  effects?: Effect[];
  meta: NodeMeta;
}

export interface FrameNode extends BaseNode {
  type: "frame";
  clip: boolean;
  dir: "ltr" | "rtl";
  layout?: AutoLayout;
  /** Layout grids drawn over the frame's content (⌃G shows/hides them; see doc/grids.ts). */
  grids?: LayoutGrid[];
}

/**
 * Figma's layout grid. Columns and rows: `count` bands (`count` 0 = as many as fit), `gutter`
 * apart; "stretch" fills the frame inside `margin`, the other alignments use bands `size` wide
 * placed `margin` (Figma's offset) from that side. Grid: square cells `size` px.
 */
export interface LayoutGrid {
  kind: "columns" | "rows" | "grid";
  count: number;
  size: number;
  gutter: number;
  margin: number;
  align: "stretch" | "start" | "center" | "end";
  /** #RRGGBBAA */
  color: string;
  /** Hidden in the panel's eye toggle. Absent = shown. */
  hidden?: boolean;
}

export interface ShapeNode extends BaseNode {
  type: "rect" | "ellipse";
}

export interface TextNode extends BaseNode {
  type: "text";
  text: TextProps;
}

export interface IconNode extends BaseNode {
  type: "icon";
  icon: string;
  strokeWidth: number;
  /** Mirror horizontally (used for directional icons in RTL). */
  mirrored: boolean;
}

export interface ImageNode extends BaseNode {
  type: "image";
  /** Object URL or data URL. */
  src: string;
  /** How the picture fills the node: cropped to cover it (the default), or whole inside it on its fill. */
  fit?: "cover" | "contain";
}

/**
 * Vector artwork: SVG path data (absolute moves, lines and cubics, see design-system/svg-path.ts)
 * drawn in a vw × vh box and scaled to the node's size. Filled and stroked with the node's paints.
 */
export interface PathNode extends BaseNode {
  type: "path";
  d: string;
  vw: number;
  vh: number;
  evenOdd?: boolean;
  /** Editable source of `d` for user-drawn or edited vectors, in the same vw × vh space (see doc/vector.ts). */
  vector?: VectorData;
  /** Decoration of open path ends. Absent = the legacy look (round). */
  ends?: { start: StrokeEnd; end: StrokeEnd };
  /** Absent = the legacy look (round). New vectors use Figma's default, miter. */
  join?: "miter" | "round" | "bevel";
  /** Parametric shapes keep their parameters until edited as a vector. */
  shape?: VectorShape;
  /** A composed shape: its parts and pins; layout rebuilds `d` for the layer's size (see doc/shape-recipe.ts). */
  recipe?: ShapeRecipe;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Figma's handleMirroring. */
export type Mirror = "none" | "angle" | "angle-length";

/** One anchor in a vector's space. Handles are offsets from the anchor; absent (or {0,0}) = no handle. */
export interface VectorPoint {
  x: number;
  y: number;
  in?: Vec2;
  out?: Vec2;
  mirror: Mirror;
  /** Per-vertex corner rounding (not drawn yet). */
  radius?: number;
}

export interface VectorPath {
  points: VectorPoint[];
  closed: boolean;
  /** Paint bucket: a closed path that shouldn't be filled. Default true. */
  filled?: boolean;
}

export interface VectorData {
  paths: VectorPath[];
}

export type StrokeEnd = "none" | "round" | "square" | "arrow-lines" | "arrow-triangle" | "triangle-reversed" | "circle" | "diamond";

export type VectorShape = { kind: "line" } | { kind: "polygon"; count: number } | { kind: "star"; count: number; ratio: number };

export type SceneNode = FrameNode | ShapeNode | TextNode | IconNode | ImageNode | PathNode;

export interface Doc {
  nodes: Record<string, SceneNode>;
  roots: string[];
  /** Project knowledge gathered by the AI critique (the "Knowledge hub"). Kept out of undo history. */
  brief?: ProjectBrief;
  /** What the designer told Qalam AI to forget or always keep (Knowledge hub). Kept out of undo history. */
  knowledge?: KnowledgeControls;
  /**
   * Prototype: links between screens, states and choreography (see doc/proto.ts). Part of undo
   * history like the nodes it points at: it is design work, and undoing a screen's deletion must
   * bring back the links to it in the same step.
   */
  proto?: Prototype;
  /**
   * Figma's pages, in order (see doc/pages.ts). The showing page's layers and prototype are
   * `roots` and `proto` above; the others keep theirs in their entry. Absent: one page.
   */
  pages?: CanvasPage[];
  /** The page showing: one of `pages`, or the Components page ("components"). Absent: the first. */
  page?: string;
  /** On the Components page: the page it was opened from (where saving and new screens go). */
  returnPage?: string;
}

/** A canvas page. The showing page's entry is kept empty: its layers live in `Doc.roots`. */
export interface CanvasPage {
  id: string;
  name: string;
  roots: string[];
  proto?: Prototype;
}

export type * from "./proto-types";
import type { Prototype } from "./proto-types";

// ---------------------------------------------------------------------------
// Knowledge hub: what the designer told the critic about the project and its screens.

export type BriefTopic = "goal" | "audience" | "problem" | "first-notice" | "primary-action" | "success-metric" | "constraints" | "other";
export type GoalVerdict = "unknown" | "meets" | "partially" | "misses";

export interface BriefAnswer {
  id: string;
  topic: BriefTopic;
  question: string;
  /** The designer's own words. */
  answer: string;
  screenIds: string[];
  at: number;
}

export interface ScreenBrief {
  name: string;
  goal: string;
  firstNotice: string;
  primaryAction: string;
  lastCritique?: { at: number; verdict: GoalVerdict; headline: string; keyIssues: string[] };
}

export interface ProjectBrief {
  /** What the project is trying to solve: synthesised by the critic from answers, editable. */
  summary: string;
  answers: BriefAnswer[];
  /** Keyed by root frame id. */
  screens: Record<string, ScreenBrief>;
  updatedAt: number;
}

export const emptyDoc = (): Doc => ({ nodes: {}, roots: [] });

export function uniformRadius(r: number, token?: string): Radius {
  return {
    linked: true,
    circular: true,
    tl: { rx: r, ry: r },
    tr: { rx: r, ry: r },
    br: { rx: r, ry: r },
    bl: { rx: r, ry: r },
    token,
  };
}

export const CORNERS = ["tl", "tr", "br", "bl"] as const;
export type CornerKey = (typeof CORNERS)[number];

export function isContainer(n: SceneNode): n is FrameNode {
  return n.type === "frame";
}
