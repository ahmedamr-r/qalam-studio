import type { Doc, MotionRef, OverlayDef, ProtoLink, Prototype, RouteAction, RouteProto, RouteRule, SceneNode, TrackPreset } from "@/doc/schema";
import type { TypeStyle } from "@/design-system/resolve";
import { motionSeconds, motionTransition, type MotionToken, type MotionTransition } from "@/design-system/motion";
import type { Feel } from "@/design-system/native-motion";
import { lucideComponent } from "@/design-system/icons";
import { DEFAULT_DELAY, DEFAULT_STATE, emptyProto, pathMatches, protoScreens, startScreen } from "@/doc/proto";
import { nodeCSS, pathPaint, type Style, type StyleValue } from "./css";
import { instanceKeys, partKeys, sharedKeys, smartPartners } from "./match";
import { camel, jsxText, key, lit, num, pascal, screenNames, unique } from "./names";
import { mergeState, nodeIn, treeOf, type VNode } from "./states";
import { TokenTable } from "./tokens";
import { viewportPlan, type ViewportPlan } from "./viewport";
import { barCode, NAV_STEP, ROUTE_TYPES } from "./overlays";
import { calmCode, feelFor, motionCode as feelMotion, overlayCode, pressCode, pressCss, pressLook, pressProps, swipeCode, swipesBack, variantsCode } from "./feel";
import { isPart } from "@/proto/routes";
import { codeEnv, dataModule, routeData, wireRoute, type RouteData } from "./data";
import { exprToTS } from "@/proto/expr";

/*
 * The prototype compiler (pure, deterministic: no model call, no ids in the output). Screens are
 * compiled from their nodes, never their specs, so screens edited by hand compile as they are.
 * Output: one React + Motion (motion.dev) + lucide-react TSX module: a component per screen, the
 * tokens as CSS, and a default-exported <Prototype /> that wires the links.
 *
 * - Smart transitions: instances whose match key (match.ts) appears on another screen get it as
 *   their Motion layoutId; a LayoutGroup per "flow" scopes them, so only smart transitions morph.
 *   The new screen comes in on top: the layers on the way to a shared one keep their opacity while
 *   their paint fades in (a layer of its own), and everything else on it fades in (`fade`).
 * - States: a state variable per screen; whatever differs between states (states.ts) becomes an
 *   expression of it. Colours and opacity tween; layout changes animate with `layout`.
 * - Tracks: initial / animate / transition with a stagger.
 * - Phone screens are viewports: the status bar and header pin to the top, the footer to the bottom,
 *   the content scrolls between them (viewport.ts).
 * - Routes: a screen's parts (sheets, dialogs, toasts, menus it opens, bars it shows) compile to
 *   components of their own; its rules become handlers that `act` (open, close, back, go), and
 *   <Prototype /> keeps which parts are open per visit and draws the overlays (overlays.ts).
 */

/** Rebuilt instances by screen, state and spec path (nodes root first; see variants.ts). */
export type StateVariants = Record<string, Record<string, Record<string, SceneNode[]>>>;

export interface CompileOptions {
  /** Root ids to compile, in order. Default: the screens the prototype uses, else every root. */
  screens?: string[];
  /** The screen Prototype opens on (a root id). Default: the prototype's start. */
  start?: string;
  variants?: StateVariants;
  /** Type styles of the screens' design system; without it the first use of a type token defines it. */
  typography?: (path: string) => TypeStyle | undefined;
  /** URL for an image source. "asset:" references need one; the default points at /assets/<hash>. */
  imageUrl?: (src: string) => string;
  /** For the header comment. */
  title?: string;
  /** For the studio's player: layers carry where they are (data-qpath, data-qname, data-qpart, data-qscreen), so its markers and cursor find them. Never in an export. */
  preview?: boolean;
}

export interface CompiledScreen {
  id: string;
  name: string;
  /** Component name ("MapFirst"). */
  component: string;
  /** Screen id in the code ("mapFirst"). */
  key: string;
  w: number;
  h: number;
  dir: "ltr" | "rtl";
}

/** One of a screen's parts, compiled as a component of its own. */
export interface CompiledPart {
  /** Its part id in the route ("options"). */
  part: string;
  /** Its frame's root id. */
  id: string;
  name: string;
  component: string;
  key: string;
  kind: OverlayDef["kind"] | "bar";
  def: OverlayDef | null;
  w: number;
  h: number;
  dir: "ltr" | "rtl";
}

export interface CompileResult {
  code: string;
  screens: CompiledScreen[];
  /** Root id Prototype opens on. */
  start: string | null;
  /** What couldn't be compiled as asked (dangling links, unknown states…). */
  warnings: string[];
  /** How it moves: as iOS, Android or the web does (feel.ts). */
  feel?: Feel;
}

export interface Ctx {
  doc: Doc;
  proto: Prototype;
  t: TokenTable;
  byId: Map<string, CompiledScreen>;
  /** Match keys by screen (instances, and the layers inside shared ones), and those each screen shares with a smart partner. */
  keys: Map<string, Map<string, string>>;
  shared: Map<string, Set<string>>;
  warnings: string[];
  react: Set<string>;
  motion: Set<string>;
  icons: Set<string>;
  motionIcons: Set<string>;
  /** Motion tokens the module uses (links and tracks with timing of their own). */
  motions: Set<MotionToken>;
  /** How it moves natively: iOS or Android for phone screens, the web for the rest (feel.ts). */
  feel: Feel;
  /** The shared variants the screens use ("fade", "fadeInShared"). */
  fades: Set<string>;
  tap: boolean;
  imageUrl: (src: string) => string;
  /** A build for the studio's player (see CompileOptions.preview). */
  preview: boolean;
  /** Screen id → its compiled parts (screens with a route). */
  parts: Map<string, CompiledPart[]>;
  /** Some screen has a route: the module carries the route runtime. */
  routes: boolean;
  /** Screen id → what compiling its route's data needs (data.ts). */
  rds: Map<string, RouteData>;
  /** Tappable layer → the rules it runs (exported as TAPS). */
  taps: Record<string, { rule: string; it?: string }[]>;
  /** Pages the routes go to that aren't designed yet: placeholder screens of the module's own. */
  pending: PendingPage[];
}

/** A page a route goes to before it's designed: a placeholder screen, until Generate draws it. */
export interface PendingPage {
  /** The screen that goes there, and the page's id in its route. */
  owner: CompiledScreen;
  page: string;
  name: string;
  /** Its screen id in the code ("basketPage") and its component ("BasketPage"). */
  key: string;
  component: string;
}

export interface Track {
  preset: TrackPreset;
  motion: MotionRef;
  delay: number;
}

export interface Hot {
  tap: string[];
  press: string[];
  enter: string[];
  leave: string[];
}

export interface ScreenCtx {
  c: Ctx;
  s: CompiledScreen;
  /** Default first. */
  states: string[];
  layoutIds: Map<VNode, string>;
  layout: Set<VNode>;
  /** Layers whose box changes with the state: their layout animation follows the state's transition. */
  stateLayout: Set<VNode>;
  /** Is, or holds, a layer with a layoutId. */
  holdsShared: Set<VNode>;
  /** Inside a layer with a layoutId. */
  inShared: Set<VNode>;
  tracks: Map<VNode, Track>;
  hot: Map<VNode, Hot>;
  styles: [string, Style][];
  names: Set<string>;
  stylesConst: string;
  usesGo: boolean;
  usesVia: boolean;
  readsSt: boolean;
  setsSt: boolean;
  /** A phone screen's pinned regions; null for parts and other platforms. */
  viewport: ViewportPlan | null;
  /** Handlers call `act` (route rules); the screen reads `open` (its bars). */
  usesAct: boolean;
  usesOpen: boolean;
  /** Bars this screen shows over its pinned bottom. */
  bars: CompiledPart[];
  /** Components whose looks follow a value (data.ts): their scope and its keys. */
  scopes: Map<VNode, { scope: Scope; keys: string[] }>;
  /** Reads the prototype's state `s` (bindings, swaps, bars). */
  usesS: boolean;
  /** Text layers whose copy shows values: their template literal. */
  texts: Map<VNode, string>;
  /** Layers that show while a value holds. */
  visible: Map<VNode, string>;
  /** Components that show as another while a value holds. */
  swaps: Map<VNode, { cond: string; alt: VNode }>;
  swapAlts: Set<VNode>;
  /** Layers that stick under the pinned top (their style). */
  sticky: Map<VNode, Style>;
  /** Rows drawn once for each element of a list (the list's code, and a divider to go between them); the layers inside them; what makes way for them. */
  repeats: Map<VNode, { list: string; divider?: VNode }>;
  inRepeat: Set<VNode>;
  dropped: Set<VNode>;
  /** The part this is (a sheet's id), when it's one of a screen's parts. */
  partId?: string;
  /** Values worked out once at the top of the component (code → its name and type), and the names taken there. */
  locals: Map<string, { name: string; type?: string }>;
  localNames: Set<string>;
}

/** Names a screen or part component already uses in its body. */
const BODY_NAMES = ["go", "via", "act", "open", "s", "st", "setSt", "present", "timers", "e", "it"];

/** The lines that work them out. */
const localLines = (sc: ScreenCtx) => [...sc.locals].map(([code, l]) => `  const ${l.name}${l.type ? `: ${l.type}` : ""} = ${code};`);

/** Values Motion tweens when a state changes; everything else switches (and `layout` animates the boxes). */
const TWEEN = new Set(["backgroundColor", "color", "opacity"]);

/** A layer's own paint (a layer that holds a shared one draws it on a layer of its own). */
const PAINT = ["backgroundColor", "backgroundImage", "borderRadius", "outline", "outlineOffset", "boxShadow"];

const TRACKS: Record<TrackPreset, { initial?: string; animate: string; loop?: boolean }> = {
  "fade-up": { initial: "{ opacity: 0, y: 16 }", animate: "{ opacity: 1, y: 0 }" },
  "scale-in": { initial: "{ opacity: 0, scale: 0.92 }", animate: "{ opacity: 1, scale: 1 }" },
  pulse: { animate: "{ scale: [1, 1.04, 1] }", loop: true },
  shimmer: { animate: "{ opacity: [1, 0.55, 1] }", loop: true },
};

const valueCode = (v: StyleValue | undefined) => (v === undefined ? "undefined" : typeof v === "number" ? num(v) : lit(v));
/** A motion as code: a token from motionTokens, or "native", the platform's own for what changes in place. */
const motionCode = (c: Ctx, ref: MotionRef) => {
  if (ref === "native") return "MOTION.change";
  c.motions.add(ref);
  return `motionTokens[${lit(ref)}]`;
};

function transitionLiteral(t: MotionTransition): string {
  return "type" in t ? `{ type: "spring", visualDuration: ${num(t.visualDuration)}, bounce: ${num(t.bounce)} }` : `{ duration: ${num(t.duration)}, ease: [${t.ease.map(num).join(", ")}] }`;
}

function find(v: VNode, test: (v: VNode) => boolean): VNode | null {
  if (test(v)) return v;
  for (const c of v.children) {
    const hit = find(c, test);
    if (hit) return hit;
  }
  return null;
}

function walk(v: VNode, fn: (v: VNode, parent: VNode | null) => void, parent: VNode | null = null) {
  fn(v, parent);
  for (const c of v.children) walk(c, fn, v);
}

// ---------------------------------------------------------------------------
// Links

function action(sc: ScreenCtx, l: ProtoLink): string | null {
  const { c, s } = sc;
  // Native: how the platform moves it (the variants know); a token: that timing.
  const via = (kind: string) => (l.transition.motion === "native" ? `{ kind: ${lit(kind)} }` : `{ kind: ${lit(kind)}, transition: ${motionCode(c, l.transition.motion)} }`);
  if (l.to === "back") {
    sc.usesGo = true;
    return `go("back", ${via(l.transition.kind)})`;
  }
  if ("state" in l.to) {
    if (!sc.states.includes(l.to.state)) {
      c.warnings.push(`"${s.name}" has no state "${l.to.state}"; that link was left out.`);
      return null;
    }
    sc.setsSt = true;
    return `setSt({ name: ${lit(l.to.state)}, t: ${motionCode(c, l.transition.motion)} })`;
  }
  const target = c.byId.get(l.to.screen);
  if (!target) {
    c.warnings.push(`A link from "${s.name}" goes to a screen that isn't in this prototype; it was left out.`);
    return null;
  }
  sc.usesGo = true;
  return `go(${lit(target.key)}, ${via(l.transition.kind)})`;
}

// ---------------------------------------------------------------------------
// One layer

/**
 * What a layer's looks are keyed by: the screen's named state (`st.name`, its links' states), or
 * — for a component whose prop follows a value — that value (a radio's `checked`, a chip row's
 * `selected`). Keys are the looks' names; `code` writes one as a literal to compare with `sel`.
 */
export interface Scope {
  sel: string;
  code: (key: string) => string;
  /** How tweens between its looks move. */
  t: string;
  /** The screen's own state (it reads `st`). */
  screen: boolean;
}
const SCREEN_SCOPE: Scope = { sel: "st.name", code: lit, t: "st.t", screen: true };

/** A ternary over a scope's key: the first key's value unless the key is one with another. */
function choose(states: string[], codes: string[], scope: Scope = SCREEN_SCOPE): string {
  const fallback = codes[0];
  const groups = new Map<string, string[]>();
  states.forEach((st, i) => {
    if (codes[i] !== fallback) groups.set(codes[i], [...(groups.get(codes[i]) ?? []), st]);
  });
  let expr = fallback;
  for (const [code, ss] of [...groups].reverse()) {
    // Said the shorter way: the looks it's in, or (when that's most of them) the ones it isn't.
    const not = states.filter((st) => !ss.includes(st));
    const cond = not.length < ss.length ? not.map((st) => `${scope.sel} !== ${scope.code(st)}`).join(" && ") : ss.map((st) => `${scope.sel} === ${scope.code(st)}`).join(" || ");
    expr = `${cond} ? ${code} : ${expr}`;
  }
  return expr;
}

const boxKey = (n: SceneNode) => [n.x, n.y, n.w, n.h].map((v) => Math.round(v * 10) / 10).join(",");

function styleName(sc: ScreenCtx, v: VNode, isRoot: boolean): string {
  if (isRoot) return unique("root", sc.names);
  const n = v.base;
  const base = camel(n.type === "icon" ? `${n.name} icon` : n.name) ?? (n.type === "text" ? "text" : n.type);
  return unique(base, sc.names);
}

function emitNode(sc: ScreenCtx, v: VNode, parent: VNode | null, inheritedStates: string[], dir: "ltr" | "rtl", depth: number, outer: Scope = SCREEN_SCOPE): string[] {
  const { c } = sc;
  const pad = "  ".repeat(depth);
  // What makes way for a row drawn for each element of a list (the design's other sample rows).
  if (sc.dropped.has(v)) return [];
  const rep = sc.repeats.get(v);
  if (rep) {
    // The row once per element (`el`), a divider between them where the design had them.
    sc.repeats.delete(v);
    const row = emitNode(sc, v, parent, inheritedStates, dir, depth + 2, outer);
    sc.repeats.set(v, rep);
    let divider: string[] = [];
    if (rep.divider) {
      sc.dropped.delete(rep.divider);
      divider = emitNode(sc, rep.divider, parent, inheritedStates, dir, depth + 3, outer);
      sc.dropped.add(rep.divider);
    }
    c.react.add("Fragment");
    return [
      `${pad}{(${rep.list} ?? []).map((el, i) => (`,
      `${pad}  <Fragment key={i}>`,
      ...(divider.length ? [`${pad}    {i > 0 && (`, ...divider, `${pad}    )}`] : []),
      ...row,
      `${pad}  </Fragment>`,
      `${pad}))}`,
    ];
  }
  // A component whose prop follows a value has looks of its own, keyed by that value.
  const own = sc.scopes.get(v);
  const scope = own?.scope ?? outer;
  const inherited = own ? own.keys : inheritedStates;
  const reads = () => {
    if (scope.screen) sc.readsSt = true;
  };
  const states = v.present ? inherited.filter((st) => v.present!.has(st)) : inherited;
  if (!states.length) return [];
  const conditional = states.length < inherited.length;
  const layoutId = sc.layoutIds.get(v);
  const layout = sc.layout.has(v);
  const literal = !!layoutId || layout;
  const per = states.map((st) => {
    const n = nodeIn(v, st);
    return { st, n, css: nodeCSS(n, { parent: parent ? nodeIn(parent, st) : null, dir }, c.t, { literal }) };
  });
  const n = per[0].n;
  const isRoot = !parent;
  const track = sc.tracks.get(v);
  const hot = sc.hot.get(v);

  // Static and per-state values.
  const keys: string[] = [];
  for (const p of per) for (const k of Object.keys(p.css.style)) if (!keys.includes(k)) keys.push(k);
  const fixed: Style = {};
  const switched: [string, string][] = [];
  const tweened: [string, string][] = [];
  for (const k of keys) {
    const vals = per.map((p) => p.css.style[k]);
    if (vals.every((x) => x === vals[0])) fixed[k] = vals[0]!;
    else {
      reads();
      const expr = choose(states, vals.map(valueCode), scope);
      (TWEEN.has(k) && vals.every((x) => x !== undefined) ? tweened : switched).push([k, expr]);
    }
  }
  if (hot && (hot.tap.length || hot.press.length)) fixed.cursor = "pointer";
  // Sticks under the pinned top while its section scrolls.
  const stick = sc.sticky.get(v);
  if (stick) {
    // Its own inline padding is in the sticky one (see data.ts), as longhands.
    if ("paddingInlineStart" in stick) for (const k of ["paddingInline", "paddingLeft", "paddingRight"]) delete fixed[k];
    Object.assign(fixed, stick);
  }
  // Shows while a value holds, or stands in for another while one does: it pops in and out.
  const pops = sc.visible.has(v) || sc.swaps.has(v) || sc.swapAlts.has(v);
  // A screen that clips would stop its pinned layers sticking: it clips without being a scroller.
  if (isRoot && sc.viewport && fixed.overflow === "hidden") fixed.overflow = "clip";

  // Smart transitions (see `fade`). A layer that holds a shared one keeps its opacity, so its paint
  // moves to a layer of its own that fades; the layers in it that hold none fade themselves.
  const fadeName = sc.inShared.has(v) ? "fadeInShared" : "fade";
  let paint: Style | null = null;
  const dynamic = [...switched, ...tweened].map(([k]) => k);
  if (sc.holdsShared.has(v) && !layoutId && n.type === "frame" && v.children.length && !PAINT.some((k) => dynamic.includes(k))) {
    // A layer that clips would clip its paint layer's shadow: it keeps the shadow, and its corners.
    const clips = fixed.overflow === "hidden";
    const moves = PAINT.filter((k) => k in fixed && !(k === "boxShadow" && clips));
    if (moves.some((k) => k !== "borderRadius" && k !== "outlineOffset")) {
      paint = { position: "absolute", inset: 0 };
      for (const k of moves) {
        paint[k] = fixed[k];
        if (k !== "borderRadius" || !clips) delete fixed[k];
      }
    }
  }
  const fades = !!parent && sc.holdsShared.has(parent) && !sc.holdsShared.has(v) && !track && !tweened.length && !conditional && !dynamic.includes("opacity");

  // Icons: the size is a prop.
  let iconName: string | null = null;
  if (n.type === "icon") {
    iconName = lucideComponent(n.icon);
    if (!iconName) {
      c.warnings.push(`Icon "${n.icon}" has no Lucide counterpart; drew "circle-help".`);
      iconName = "CircleQuestionMark";
    }
    if (n.w === n.h && fixed.width === fixed.height) {
      delete fixed.width;
      delete fixed.height;
    }
  }

  const classes = per.map((p) => p.css.className ?? "");
  let classAttr = "";
  if (isRoot) classAttr = `className="q-screen"`;
  else if (classes.some((x) => x !== classes[0])) {
    reads();
    classAttr = `className={${choose(states, classes.map(lit), scope)}}`;
  } else if (classes[0]) classAttr = `className=${lit(classes[0])}`;

  // Element.
  const anim = !!layoutId || layout || !!track || tweened.length > 0 || conditional || fades || pops;
  let tag: string;
  if (n.type === "icon") {
    const plain = `${iconName}Icon`;
    c.icons.add(plain);
    if (anim) {
      c.motionIcons.add(plain);
      c.motion.add("motion");
      tag = `Motion${plain}`;
    } else tag = plain;
  } else {
    const el = n.type === "text" ? "p" : n.type === "image" ? "img" : n.type === "path" ? "svg" : "div";
    if (anim) c.motion.add("motion");
    tag = anim ? `motion.${el}` : el;
  }

  const attrs: string[] = [];
  const hasFixed = Object.keys(fixed).length > 0;
  const name = hasFixed || paint ? styleName(sc, v, isRoot) : null;
  if (name && hasFixed) sc.styles.push([name, fixed]);
  const paintName = paint ? unique(`${name}Paint`, sc.names) : null;
  if (paint) sc.styles.push([paintName!, paint]);
  if (conditional) attrs.push(`key=${lit(name ?? styleName(sc, v, isRoot))}`);
  else if (pops) attrs.push(`key=${lit(`${name ?? styleName(sc, v, isRoot)}${sc.swapAlts.has(v) ? "-on" : sc.swaps.has(v) ? "-off" : ""}`)}`);
  if (layoutId) attrs.push(`layoutId=${lit(layoutId)}`);
  // Text and icons only move when they morph: scaling their box would stretch the glyphs ("Call" →
  // "Contact support" crossfades in place of stretching).
  if (layoutId && (n.type === "text" || n.type === "icon")) attrs.push(`layout="position"`);
  else if (layout) attrs.push("layout");
  if (fades) {
    c.fades.add(fadeName);
    // A layer that's partly transparent fades in to its own opacity.
    attrs.push(`variants={${fixed.opacity === undefined ? fadeName : `{ ...${fadeName}, center: { opacity: ${valueCode(fixed.opacity)} } }`}}`);
  }
  if (classAttr) attrs.push(classAttr);
  // The player finds layers by where they are in the design: the frame, a spec path, a layer name.
  if (c.preview) {
    if (isRoot) attrs.push(sc.partId ? `data-qpart=${lit(sc.partId)}` : `data-qscreen=${lit(sc.s.key)}`);
    if (n.meta.specPath !== undefined) attrs.push(`data-qpath=${lit(n.meta.specPath)}`, ...(n.meta.component ? [`data-qcomp=${lit(n.meta.component)}`] : []));
    if (n.meta.specPath !== undefined || n.meta.interactive) attrs.push(`data-qname=${lit(n.name)}`);
  }
  if (hasFixed && !switched.length) attrs.push(`style={${sc.stylesConst}.${name}}`);
  else if (switched.length) attrs.push(`style={{ ${[...(hasFixed ? [`...${sc.stylesConst}.${name}`] : []), ...switched.map(([k, e]) => `${key(k)}: ${e}`)].join(", ")} }}`);

  if (n.type === "image") {
    const srcs = per.map((p) => (p.n.type === "image" ? lit(c.imageUrl(p.n.src)) : `""`));
    attrs.push(srcs.every((x) => x === srcs[0]) ? `src=${srcs[0]}` : `src={${choose(states, srcs, scope)}}`, `alt=""`, "draggable={false}");
  }
  if (n.type === "icon") {
    if (n.w === n.h) attrs.push(`size={${num(n.w)}}`);
    if (n.strokeWidth !== 2) attrs.push(`strokeWidth={${num(n.strokeWidth)}}`);
  }
  if (n.type === "path") attrs.push(`viewBox=${lit(`0 0 ${num(n.vw)} ${num(n.vh)}`)}`, `preserveAspectRatio="none"`, `aria-hidden`);

  // Motion: a track's entrance or loop, state tweens, presence.
  let initial: string | null = null;
  let animate: string[] = [];
  let transition: string | null = null;
  if (track) {
    const p = TRACKS[track.preset];
    if (p.initial) {
      // A layer that is (or holds) a shared one morphs in a smart transition instead of entering.
      if (sc.holdsShared.has(v)) {
        sc.usesVia = true;
        initial = `via?.kind === "smart" ? false : ${p.initial}`;
      } else initial = p.initial;
    }
    animate = [p.animate.slice(2, -2)];
    if (p.loop) transition = `{ duration: ${num(motionSeconds(track.motion) * 4)}, ease: "easeInOut", repeat: Infinity${track.delay ? `, delay: ${num(track.delay)}` : ""} }`;
    else transition = track.delay ? `{ ...${motionCode(c, track.motion)}, delay: ${num(track.delay)} }` : motionCode(c, track.motion);
  }
  if (tweened.length) {
    animate.push(...tweened.map(([k, e]) => `${key(k)}: ${e}`));
    if (!track) initial = "false";
  }
  if (conditional) {
    initial = "{ opacity: 0 }";
    animate = ["opacity: 1", ...animate.filter((a) => !a.startsWith("opacity:"))];
  }
  if (!transition && (tweened.length || conditional || sc.stateLayout.has(v))) {
    reads();
    transition = scope.t;
  }
  // One look giving way to another in place (a + to a count): they cross-fade, as SwiftUI's default
  // transition and Material's fade do, on the platform's motion for changes.
  if (pops && !track && !conditional) {
    initial = "{ opacity: 0 }";
    animate = ["opacity: 1", ...animate.filter((a) => !a.startsWith("opacity:"))];
    transition ??= "MOTION.change";
  }
  if (initial) attrs.push(`initial={${initial}}`);
  if (animate.length) attrs.push(`animate={{ ${animate.join(", ")} }}`);
  if (conditional) attrs.push(`exit={{ opacity: 0 }}`);
  else if (pops) attrs.push(`exit={{ opacity: 0 }}`);
  if (transition) attrs.push(`transition={${transition}}`);

  if (hot) {
    const run = (codes: string[]) => {
      const arg = codes.some((x) => x.endsWith(", e)")) ? "(e)" : "()";
      return codes.length === 1 ? `${arg} => ${codes[0]}` : `${arg} => {\n${codes.map((x) => `${pad}    ${x};`).join("\n")}\n${pad}  }`;
    };
    if (hot.tap.length) {
      c.tap = true;
      attrs.push(pressLook(c.doc, n.id) === "fill" ? `{...tap(${run(hot.tap)}, "fill")}` : `{...tap(${run(hot.tap)})}`);
    }
    if (hot.press.length) attrs.push(`onPointerDown={${run(hot.press)}}`);
    if (hot.enter.length) attrs.push(`onPointerEnter={${run(hot.enter)}}`);
    if (hot.leave.length) attrs.push(`onPointerLeave={${run(hot.leave)}}`);
  }

  // Content.
  const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  let out: string[];
  if (n.type === "text") {
    const texts = per.map((p) => (p.n.type === "text" ? p.n.text.content : ""));
    const same = texts.every((x) => x === texts[0]);
    const live = sc.texts.get(v);
    if (!same && !live) reads();
    const body = live ? `{${live}}` : same ? jsxText(texts[0]) : `{${choose(states, texts.map(lit), scope)}}`;
    out = [`${pad}${open}>${body}</${tag}>`];
  } else if (n.type === "path") {
    const paint = pathPaint(n, c.t);
    const props = Object.entries(paint).map(([k, x]) => `${k}=${typeof x === "number" ? `{${num(x)}}` : lit(String(x))}`);
    out = [`${pad}${open}>`, `${pad}  <path d=${lit(n.d)}${n.evenOdd ? ` fillRule="evenodd"` : ""} ${props.join(" ")} vectorEffect="non-scaling-stroke" />`, `${pad}</${tag}>`];
  } else if (n.type === "frame" && v.children.length) {
    const childDir = n.dir;
    const paintLayer: string[] = [];
    if (paintName) {
      c.fades.add(fadeName);
      paintLayer.push(`${pad}  <motion.div variants={${fadeName}} style={${sc.stylesConst}.${paintName}} />`);
    }
    out = [`${pad}${open}>`, ...paintLayer, ...emitChildren(sc, v, states, childDir, depth, isRoot ? per[0].css.style : null, scope), `${pad}</${tag}>`];
  } else out = [`${pad}${open} />`];

  // A swap: the other component while its value holds, this one otherwise.
  const sw = sc.swaps.get(v);
  if (sw) {
    sc.swapAlts.add(sw.alt);
    // It stands in for the original: tapping it does what tapping that did.
    const hot = sc.hot.get(v);
    if (hot) sc.hot.set(sw.alt, hot);
    c.motion.add("AnimatePresence");
    const alt = emitNode(sc, sw.alt, parent, inherited, dir, depth + 2, scope);
    out = [`${pad}<AnimatePresence initial={false} mode="popLayout">`, `${pad}  {(${sw.cond}) ? (`, ...alt, `${pad}  ) : (`, ...out.map((l) => `    ${l}`), `${pad}  )}`, `${pad}</AnimatePresence>`];
  }
  const shows = sc.visible.get(v);
  if (shows) {
    c.motion.add("AnimatePresence");
    // What leaves steps out of the layout as it fades, so what takes its place (a tab's section) is already there.
    out = [`${pad}<AnimatePresence initial={false} mode="popLayout">`, `${pad}  {(${shows}) && (`, ...out.map((l) => `    ${l}`), `${pad}  )}`, `${pad}</AnimatePresence>`];
  }
  if (!conditional) return out;
  c.motion.add("AnimatePresence");
  const cond = states.length <= inherited.length / 2 || inherited.length - states.length > 1
    ? states.map((st) => `${scope.sel} === ${scope.code(st)}`).join(" || ")
    : inherited.filter((st) => !states.includes(st)).map((st) => `${scope.sel} !== ${scope.code(st)}`).join(" && ");
  reads();
  return [`${pad}<AnimatePresence initial={false}>`, `${pad}  {(${cond}) && (`, ...out.map((l) => `    ${l}`), `${pad}  )}`, `${pad}</AnimatePresence>`];
}

/**
 * A frame's children. On a phone screen (sc.viewport) the root's top and bottom regions go in
 * wrappers that stick while the rest scrolls, the bars the screen shows join the bottom one, and
 * the hero's Backdrop keeps the room of what was hoisted out of it.
 */
function emitChildren(sc: ScreenCtx, v: VNode, states: string[], dir: "ltr" | "rtl", depth: number, rootStyle: Style | null, scope: Scope = SCREEN_SCOPE): string[] {
  const vp = sc.viewport;
  const pad = "  ".repeat(depth + 1);
  const emit = (ch: VNode, parent: VNode, d = depth + 1) => emitNode(sc, ch, parent, states, dir, d, scope);
  if (!vp) return v.children.flatMap((ch) => emit(ch, v));
  if (v === vp.backdrop) {
    const hoisted = new Set(vp.top);
    return [`${pad}<div style={{ height: ${num(vp.hoisted)}, flexShrink: 0 }} />`, ...v.children.filter((ch) => !hoisted.has(ch)).flatMap((ch) => emit(ch, v))];
  }
  if (!rootStyle) return v.children.flatMap((ch) => emit(ch, v));
  // What the screen is painted with shows behind the pinned regions, so content doesn't show through them.
  const paint: Style = {};
  for (const k of ["backgroundColor", "backgroundImage"]) if (rootStyle[k] !== undefined) paint[k] = rootStyle[k];
  const pin = (edge: "top" | "bottom", extra: Style): string => {
    const name = unique(edge === "top" ? "pinnedTop" : "pinnedBottom", sc.names);
    sc.styles.push([name, { position: "sticky", [edge]: 0, zIndex: 3, alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "stretch", ...extra }]);
    return name;
  };
  const top = new Set(vp.top);
  const bottom = new Set(vp.bottom);
  const lines: string[] = [];
  if (vp.top.length) {
    // Hoisted from the Backdrop: it overlaps the Backdrop's spacer, over the gradient.
    const name = pin("top", vp.backdrop ? { marginBottom: -vp.hoisted } : paint);
    const parent = vp.backdrop ?? v;
    lines.push(`${pad}<div style={${sc.stylesConst}.${name}}>`, ...vp.top.flatMap((ch) => emit(ch, parent, depth + 2)), `${pad}</div>`);
  }
  lines.push(...v.children.filter((ch) => !top.has(ch) && !bottom.has(ch)).flatMap((ch) => emit(ch, v)));
  if (vp.bottom.length || sc.bars.length) {
    const name = pin("bottom", vp.bottom.length ? paint : {});
    if (sc.bars.length) {
      sc.usesOpen = true;
      sc.usesAct = true;
      sc.c.motion.add("AnimatePresence");
    }
    lines.push(
      `${pad}<div style={${sc.stylesConst}.${name}}>`,
      ...sc.bars.flatMap((b) => barCode(`${pad}  `, b.part, b.component, barCond(sc, b))),
      ...vp.bottom.flatMap((ch) => emit(ch, v, depth + 2)),
      `${pad}</div>`,
    );
  }
  return lines;
}

/** When a bar shows: while its `when` holds (a basket bar once something's in the basket), else while it's open. */
function barCond(sc: ScreenCtx, b: CompiledPart): string | undefined {
  const rd = sc.c.rds.get(sc.s.id);
  const when = rd?.route.addOns[b.part]?.when;
  if (!rd || when === undefined) return undefined;
  sc.usesS = true;
  return exprToTS(when, codeEnv(rd));
}

// ---------------------------------------------------------------------------
// Routes: rules into handlers

// ---------------------------------------------------------------------------
// One screen

function emitScreen(c: Ctx, s: CompiledScreen, variants: Record<string, Record<string, SceneNode[]>> | undefined): string[] {
  const { doc, proto } = c;
  const root = treeOf((id) => doc.nodes[id], s.id)!;
  const named = Object.keys(proto.states[s.id] ?? {}).filter((n) => n !== DEFAULT_STATE);
  const states = [DEFAULT_STATE, ...named];
  for (const st of named) {
    const built = variants?.[st];
    if (!built || !Object.keys(built).length) {
      c.warnings.push(`State "${st}" of "${s.name}" changes nothing that could be built; it looks like the default.`);
      continue;
    }
    for (const [path, nodes] of Object.entries(built)) {
      const target = find(root, (v) => v.base.meta.specPath === path);
      if (target && nodes.length) mergeState(target, nodes, st, states);
      else c.warnings.push(`State "${st}" of "${s.name}" changes ${path}, which isn't on the screen.`);
    }
  }

  const sc: ScreenCtx = {
    c,
    s,
    states,
    layoutIds: new Map(),
    layout: new Set(),
    stateLayout: new Set(),
    holdsShared: new Set(),
    inShared: new Set(),
    tracks: new Map(),
    hot: new Map(),
    styles: [],
    names: new Set(),
    stylesConst: `${s.key}Styles`,
    usesGo: false,
    usesVia: false,
    readsSt: false,
    setsSt: false,
    viewport: viewportPlan(root),
    usesAct: false,
    usesOpen: false,
    bars: [],
    scopes: new Map(),
    usesS: false,
    texts: new Map(),
    visible: new Map(),
    swaps: new Map(),
    swapAlts: new Set(),
    sticky: new Map(),
    repeats: new Map(),
    inRepeat: new Set(),
    dropped: new Set(),
    locals: new Map(),
    localNames: new Set(BODY_NAMES),
  };
  const bars = (c.parts.get(s.id) ?? []).filter((p) => p.kind === "bar");
  if (bars.length && !sc.viewport) c.warnings.push(`"${s.name}" shows bars, which play on phone screens for now; they were left out.`);
  else sc.bars = bars;

  // Shared layers and what animates its layout.
  const keys = c.keys.get(s.id)!;
  const shared = c.shared.get(s.id)!;
  walk(root, (v, parent) => {
    const k = parent ? keys.get(v.base.id) : undefined;
    if (k && shared.has(k) && v.present === null) sc.layoutIds.set(v, k);
    // A layer in a morphing one that doesn't morph itself keeps its shape (Motion's scale correction needs it to be a layout layer).
    else if (parent && sc.layoutIds.has(parent)) sc.layout.add(v);
    const boxes = states.map((st) => boxKey(nodeIn(v, st)));
    if (boxes.some((b) => b !== boxes[0])) {
      for (const x of [v, ...v.children]) {
        sc.layout.add(x);
        sc.stateLayout.add(x);
      }
    }
  });
  const holds = (v: VNode): boolean => {
    const own = sc.layoutIds.has(v);
    const inside = v.children.map(holds).some(Boolean);
    if (own || inside) sc.holdsShared.add(v);
    return own || inside;
  };
  holds(root);
  walk(root, (v, parent) => {
    if (parent && (sc.layoutIds.has(parent) || sc.inShared.has(parent))) sc.inShared.add(v);
  });

  // Tracks.
  for (const t of proto.tracks) {
    if (t.target.screen !== s.id) continue;
    const hits: VNode[] = [];
    if (!t.target.path) hits.push(root);
    else walk(root, (v, parent) => {
      const p = v.base.meta.specPath;
      if (parent && p !== undefined && v.present === null && pathMatches(t.target.path!, p)) hits.push(v);
    });
    if (!hits.length) c.warnings.push(`Nothing on "${s.name}" matches ${t.target.path}; that track was left out.`);
    hits.forEach((v, i) => sc.tracks.set(v, { preset: t.preset, motion: t.motion, delay: ((t.stagger ?? 0) * i) / 1000 }));
  }

  // Links.
  const delays: { code: string; after: number }[] = [];
  for (const l of proto.links) {
    if (l.from.screen !== s.id) continue;
    const code = action(sc, l);
    if (!code) continue;
    if (l.on === "delay") {
      delays.push({ code, after: l.after ?? DEFAULT_DELAY });
      continue;
    }
    const target = l.from.path ? find(root, (v) => v.base.meta.specPath === l.from.path) : root;
    if (!target) {
      c.warnings.push(`Nothing on "${s.name}" is at ${l.from.path}; that link was left out.`);
      continue;
    }
    const h = sc.hot.get(target) ?? { tap: [], press: [], enter: [], leave: [] };
    if (l.on === "tap") h.tap.push(code);
    else if (l.on === "press") h.press.push(code);
    else {
      h.enter.push(code);
      // Hovering into a state is "while hovering": leaving goes back to the default.
      if (typeof l.to === "object" && "state" in l.to) h.leave.push(`setSt({ name: "default", t: ${motionCode(c, l.transition.motion)} })`);
    }
    sc.hot.set(target, h);
  }
  // The route: its rules as handlers that run them, its data shown by bindings (data.ts); timers start with the screen.
  const rd = c.rds.get(s.id);
  if (rd) {
    wireRoute(sc, root, rd);
    for (const ru of rd.route.rules) {
      if (ru.when.on !== "enter" && ru.when.on !== "delay") continue;
      sc.usesAct = true;
      delays.push({ code: `act({ do: "run", rule: ${lit(ru.id)} })`, after: ru.when.on === "delay" ? ru.when.ms : 0 });
    }
  }

  const jsx = emitNode(sc, root, null, states, "ltr", 2);

  const lines: string[] = [];
  const props = [sc.usesGo && "go", sc.usesVia && "via", sc.usesAct && "act", sc.usesOpen && "open", sc.usesS && "s"].filter(Boolean);
  lines.push(`/** ${s.name.replace(/\*\//g, "*\\/")} */`);
  lines.push(`export function ${s.component}(${props.length ? `{ ${props.join(", ")} }` : "_props"}: ScreenProps) {`);
  if (sc.readsSt || sc.setsSt) {
    c.react.add("useState");
    c.motion.add("type Transition");
    const type = states.map(lit).join(" | ");
    const pair = sc.readsSt && sc.setsSt ? "[st, setSt]" : sc.readsSt ? "[st]" : "[, setSt]";
    lines.push(`  const ${pair} = useState<{ name: ${type}; t?: Transition }>({ name: "default" });`);
    if (!sc.setsSt) c.warnings.push(`No link changes the state of "${s.name}"; it stays in its default.`);
  }
  lines.push(...localLines(sc));
  if (delays.length) {
    c.react.add("useEffect");
    c.motion.add("useIsPresent");
    lines.push("  // Timers run while the screen is showing (not while it leaves).");
    lines.push("  const present = useIsPresent();");
    lines.push("  useEffect(() => {");
    lines.push("    if (!present) return;");
    lines.push(`    const timers = [${delays.map((d) => `setTimeout(() => ${d.code}, ${d.after})`).join(", ")}];`);
    lines.push("    return () => timers.forEach(clearTimeout);");
    lines.push(`  }, [${["present", ...(sc.usesGo ? ["go"] : []), ...(sc.usesAct ? ["act"] : [])].join(", ")}]);`);
  }
  lines.push("  return (", ...jsx, "  );", "}");
  if (sc.styles.length) {
    c.react.add("type CSSProperties");
    lines.push("", `const ${sc.stylesConst} = {`);
    for (const [k, style] of sc.styles) {
      const entries = Object.entries(style).map(([p, x]) => `${key(p)}: ${valueCode(x)}`);
      const one = `  ${key(k)}: { ${entries.join(", ")} },`;
      if (one.length <= 120) lines.push(one);
      else lines.push(`  ${key(k)}: {`, ...entries.map((e) => `    ${e},`), "  },");
    }
    lines.push("} satisfies Record<string, CSSProperties>;");
  }
  return lines;
}

/** One of a screen's parts (a sheet, dialog, toast, menu or bar) as a component: its frame, and the rules that start in it. */
function emitPart(c: Ctx, owner: CompiledScreen, cp: CompiledPart): string[] {
  const root = treeOf((id) => c.doc.nodes[id], cp.id);
  if (!root) return [];
  const s: CompiledScreen = { id: cp.id, name: `${owner.name} › ${cp.name}`, component: cp.component, key: cp.key, w: cp.w, h: cp.h, dir: cp.dir };
  const sc: ScreenCtx = {
    c,
    partId: cp.part,
    s,
    states: [DEFAULT_STATE],
    layoutIds: new Map(),
    layout: new Set(),
    stateLayout: new Set(),
    holdsShared: new Set(),
    inShared: new Set(),
    tracks: new Map(),
    hot: new Map(),
    styles: [],
    names: new Set(),
    stylesConst: `${cp.key}Styles`,
    usesGo: false,
    usesVia: false,
    readsSt: false,
    setsSt: false,
    viewport: null,
    usesAct: false,
    usesOpen: false,
    bars: [],
    scopes: new Map(),
    usesS: false,
    texts: new Map(),
    visible: new Map(),
    swaps: new Map(),
    swapAlts: new Set(),
    sticky: new Map(),
    repeats: new Map(),
    inRepeat: new Set(),
    dropped: new Set(),
    locals: new Map(),
    localNames: new Set(BODY_NAMES),
  };
  const rd = c.rds.get(owner.id);
  if (rd) wireRoute(sc, root, rd, cp);
  const jsx = emitNode(sc, root, null, sc.states, "ltr", 2);
  const props = [sc.usesAct && "act", sc.usesS && "s"].filter(Boolean);
  const lines: string[] = [`/** ${s.name.replace(/\*\//g, "*\\/")} (${cp.kind}) */`, `export function ${cp.component}(${props.length ? `{ ${props.join(", ")} }` : "_props"}: PartProps) {`, ...localLines(sc), "  return (", ...jsx, "  );", "}"];
  if (sc.styles.length) {
    c.react.add("type CSSProperties");
    lines.push("", `const ${sc.stylesConst} = {`);
    for (const [k, style] of sc.styles) {
      const entries = Object.entries(style).map(([p, x]) => `${key(p)}: ${valueCode(x)}`);
      const one = `  ${key(k)}: { ${entries.join(", ")} },`;
      if (one.length <= 120) lines.push(one);
      else lines.push(`  ${key(k)}: {`, ...entries.map((e) => `    ${e},`), "  },");
    }
    lines.push("} satisfies Record<string, CSSProperties>;");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The module

function screensFor(doc: Doc, wanted: string[] | undefined): string[] {
  const ids = wanted ?? (protoScreens(doc).length ? protoScreens(doc) : doc.roots);
  // A route's parts play inside their screen, never as screens of their own.
  return [...new Set(ids)].filter((id) => doc.nodes[id]?.type === "frame" && !doc.nodes[id].parentId && !isPart(doc, id));
}

/** Each screen's parts, named after it ("Menu" + "Options" → MenuOptions). */
function partsFor(doc: Doc, proto: Prototype, screens: CompiledScreen[]): Map<string, CompiledPart[]> {
  const used = new Set(["Prototype", ...screens.map((s) => s.component)]);
  const out = new Map<string, CompiledPart[]>();
  for (const s of screens) {
    const r = proto.routes?.[s.id];
    if (!r) continue;
    const list: CompiledPart[] = [];
    const add = (part: string, frame: string, kind: CompiledPart["kind"], def: OverlayDef | null) => {
      const n = doc.nodes[frame];
      if (!n || n.type !== "frame") return;
      const component = unique(`${s.component}${pascal(n.name) ?? pascal(part) ?? "Part"}`, used);
      list.push({ part, id: frame, name: n.name, component, key: component[0].toLowerCase() + component.slice(1), kind, def, w: Math.round(n.w), h: Math.round(n.h), dir: n.dir });
    };
    for (const [part, o] of Object.entries(r.overlays)) add(part, o.frame, o.kind, o);
    for (const [part, a] of Object.entries(r.addOns)) add(part, a.frame, "bar", null);
    out.set(s.id, list);
  }
  return out;
}

export function compilePrototype(doc: Doc, opts: CompileOptions = {}): CompileResult {
  const proto = doc.proto ?? emptyProto();
  const ids = screensFor(doc, opts.screens);
  const names = screenNames(ids.map((id) => doc.nodes[id].name));
  const screens: CompiledScreen[] = ids.map((id, i) => {
    const n = doc.nodes[id];
    const component = names[i];
    return { id, name: n.name, component, key: component[0].toLowerCase() + component.slice(1), w: Math.round(n.w), h: Math.round(n.minH ?? n.h), dir: n.type === "frame" ? n.dir : "ltr" };
  });
  const warnings: string[] = [];
  // Instances match across smart partners; inside shared ones, their layers match too.
  const partners = smartPartners(proto, ids);
  const keys = new Map(ids.map((id) => [id, instanceKeys(doc, id, proto.keys?.[id])]));
  const sharedInstances = sharedKeys(keys, partners);
  for (const id of ids) {
    const own = keys.get(id)!;
    const parts = new Map<string, string>();
    for (const [node, k] of own) if (sharedInstances.get(id)!.has(k)) partKeys(doc, node, k, own, parts);
    for (const [node, k] of parts) own.set(node, k);
  }
  let assetWarned = false;
  const c: Ctx = {
    doc,
    proto,
    t: new TokenTable(opts.typography),
    byId: new Map(screens.map((s) => [s.id, s])),
    keys,
    shared: sharedKeys(keys, partners),
    warnings,
    react: new Set(),
    motion: new Set(),
    icons: new Set(),
    motionIcons: new Set(),
    motions: new Set(),
    feel: "ios",
    fades: new Set(),
    tap: false,
    parts: new Map(),
    routes: false,
    rds: new Map(),
    taps: {},
    pending: [],
    preview: !!opts.preview,
    imageUrl:
      opts.imageUrl ??
      ((src) => {
        if (!src.startsWith("asset:")) return src;
        if (!assetWarned) warnings.push("Images point at /assets/<hash>: put the picture files there.");
        assetWarned = true;
        return `/assets/${src.slice("asset:".length)}`;
      }),
  };
  const startId = opts.start && c.byId.has(opts.start) ? opts.start : (startScreen(proto, ids) ?? null);
  if (!screens.length) return { code: "// Nothing to compile: no screens.\n", screens, start: null, warnings: ["No screens to compile."] };
  c.feel = feelFor(doc, startId ?? screens[0].id, proto.feel);

  c.parts = partsFor(doc, proto, screens);
  c.routes = screens.some((s) => !!proto.routes?.[s.id]);
  // Rules' links with a timing of their own: their tokens go in motionTokens, which is written before the rules.
  for (const s of screens) for (const r of proto.routes?.[s.id]?.rules ?? []) for (const a of r.then) if ((a.do === "go" || a.do === "next") && a.transition.motion !== "native") c.motions.add(a.transition.motion);
  // Pages the routes go to that aren't designed yet, named apart from the screens and their parts.
  const taken = new Set(["Prototype", ...screens.flatMap((s) => [s.key, s.component]), ...[...c.parts.values()].flat().map((p) => p.component)]);
  for (const s of screens)
    for (const [page, np] of Object.entries(proto.routes?.[s.id]?.next ?? {}))
      c.pending.push({ owner: s, page, name: np.name, key: unique(camel(`${np.name} page`) ?? "nextPage", taken), component: unique(pascal(`${np.name} page`) ?? "NextPage", taken) });
  for (const s of screens) {
    const rd = routeData(c, s);
    if (rd) c.rds.set(s.id, rd);
  }
  const bodies = [
    ...screens.flatMap((s) => ["", ...emitScreen(c, s, opts.variants?.[s.id]), ...(c.parts.get(s.id) ?? []).flatMap((cp) => ["", ...emitPart(c, s, cp)])]),
    ...c.pending.flatMap((p) => ["", ...pendingScreen(c, p)]),
  ];
  if (c.routes) {
    c.react.add("useEffect").add("useRef").add("type CSSProperties");
  }
  const start = c.byId.get(startId!) ?? screens[0];

  // Prototype.
  c.react.add("useCallback").add("useState").add("type ReactNode");
  ["AnimatePresence", "LayoutGroup", "MotionConfig", "motion", "type Transition", "type Variants", "useReducedMotion"].forEach((x) => c.motion.add(x));

  const out: string[] = [];
  const title = opts.title ?? (screens.length === 1 ? screens[0].name : `${screens.length} screens`);
  out.push(
    "/**",
    ` * ${title.replace(/\*\//g, "*\\/")} — a prototype generated by Qalam Studio.`,
    " *",
    " * React, Motion (motion.dev) and Lucide. Each screen is a component; <Prototype /> plays their",
    " * links. Tokens are CSS variables and type classes in `qalamCSS`: Prototype adds it, so render it",
    " * once yourself if you use a screen on its own. Nothing here calls Qalam.",
    " */",
  );
  const sorted = (xs: Iterable<string>) => [...xs].sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));
  out.push(`import { ${sorted(c.react).join(", ")} } from "react";`);
  out.push(`import { ${sorted(c.motion).join(", ")} } from "motion/react";`);
  if (c.icons.size) out.push(`import { ${sorted(c.icons).join(", ")} } from "lucide-react";`);
  const css = c.t.css() + (c.tap ? `\n${pressCss(c.feel)}` : "");
  out.push("", "export const qalamCSS = `", css.replace(/[`\\$]/g, (m) => `\\${m}`), "`;");

  out.push("", ...feelMotion(c.feel, c));
  if (c.motions.size) {
    out.push("", "/** Motion tokens (Qalam's motion.* table): links and tracks with a timing of their own. */", "const motionTokens = {");
    for (const ref of [...c.motions].sort()) out.push(`  ${lit(ref)}: ${transitionLiteral(motionTransition(ref))},`);
    out.push("} satisfies Record<string, Transition>;");
  }
  if (c.motionIcons.size) {
    out.push("");
    for (const icon of sorted(c.motionIcons)) out.push(`const Motion${icon} = motion.create(${icon});`);
  }

  out.push(
    "",
    `export type ScreenId = ${[...screens.map((s) => s.key), ...c.pending.map((p) => p.key)].map(lit).join(" | ")};`,
    "",
    "/** How a screen was reached: the link's kind, its timing when it has one of its own (else the platform's), and whether it went back. */",
    "export interface Via {",
    `  kind: "smart" | "push" | "dissolve" | "sheet";`,
    "  transition?: Transition;",
    "  back?: boolean;",
    `  dir?: "ltr" | "rtl";`,
    "}",
    "",
    "export interface ScreenProps {",
    "  /** Go to another screen, or back to the one before. */",
    `  go: (to: ScreenId | "back", via: Via) => void;`,
    "  /** How this screen was reached (absent for the first one). */",
    "  via?: Via;",
    ...(c.routes
      ? [
          "  /** Run one of the screen's rules, open or close a part, go back, or go to another screen. */",
          "  act: Act;",
          "  /** The screen's parts that are open (its bars show while theirs is). */",
          "  open: string[];",
          "  /** Where the prototype is: what each screen and the app remember. */",
          "  s: State;",
        ]
      : []),
    "}",
  );
  if (c.routes) out.push("", ...ROUTE_TYPES);
  // Press feedback (feel.ts): the look in qalamCSS, the handlers here. A sheet's drag ends a press, so routes carry them too.
  if (c.tap || c.routes) out.push("", ...pressCode(c.feel, c));
  if (c.tap) {
    c.react.add("type KeyboardEvent");
    if (c.routes) c.react.add("type MouseEvent");
    const pressing = pressProps(c.feel).map((x) => `  ${x}`);
    out.push(
      "",
      `/** A tap target: click, or Enter / Space when it has focus; pressed while the pointer is down on it, as a control ("dim") or as a row, a card or a button ("fill"). */`,
      ...(c.routes
        ? [
            `const tap = (run: (e: TapEvent) => void, look: "dim" | "fill" = "dim") => ({`,
            `  role: "button" as const,`,
            "  tabIndex: 0,",
            ...pressing,
            "  onClick: (e: MouseEvent) => run(e),",
            "  onKeyDown: (e: KeyboardEvent) => {",
            `    if (e.key === "Enter" || e.key === " ") {`,
            "      e.preventDefault();",
            "      run(e);",
            "    }",
            "  },",
            "});",
          ]
        : [
            `const tap = (run: () => void, look: "dim" | "fill" = "dim") => ({`,
            `  role: "button" as const,`,
            "  tabIndex: 0,",
            ...pressing,
            "  onClick: run,",
            "  onKeyDown: (e: KeyboardEvent) => {",
            `    if (e.key === "Enter" || e.key === " ") {`,
            "      e.preventDefault();",
            "      run();",
            "    }",
            "  },",
            "});",
          ]),
    );
  }
  if (c.fades.size) {
    out.push(
      "",
      "/**",
      " * Smart transitions: the new screen comes in on top (its \"smart\" label) and what on it isn't shared",
      " * fades in — and so does the paint of the layers that hold shared ones, on a layer of its own, so",
      " * the shared layers keep their opacity while they morph.",
      " */",
      "const fade: Variants = { smart: { opacity: 0 }, center: { opacity: 1 } };",
    );
    if (c.fades.has("fadeInShared")) {
      out.push(
        "",
        "/** Inside a shared layer, they also go at once when their screen leaves: Motion carries the layer, not them. */",
        `const fadeInShared: Variants = { ...fade, exit: (v?: Via) => (v?.kind === "smart" ? { opacity: 0, transition: { duration: 0 } } : {}) };`,
      );
    }
  }
  out.push(...bodies);

  out.push(
    "",
    `${c.routes ? "export " : ""}const SCREENS: Record<ScreenId, { Screen: (props: ScreenProps) => ReactNode; width: number; height: number; dir: "ltr" | "rtl" }> = {`,
    ...screens.map((s) => `  ${key(s.key)}: { Screen: ${s.component}, width: ${s.w}, height: ${s.h}, dir: ${lit(s.dir)} },`),
    ...c.pending.map((p) => `  ${key(p.key)}: { Screen: ${p.component}, width: ${p.owner.w}, height: ${p.owner.h}, dir: ${lit(p.owner.dir)} },`),
    "};",
    ...(c.pending.length
      ? [
          "",
          "/** Pages not designed yet, by the placeholder screen each has: the screen that goes there, and the page in its route. */",
          "export const PENDING: Partial<Record<ScreenId, { from: ScreenId; page: string; name: string }>> = {",
          ...c.pending.map((p) => `  ${key(p.key)}: { from: ${lit(p.owner.key)}, page: ${lit(p.page)}, name: ${lit(p.name)} },`),
          "};",
        ]
      : []),
    "",
    ...variantsCode(c.feel),
    "",
    ...calmCode(c.feel),
    "",
  );
  // Screens that can go somewhere swipe back, where the platform's do.
  const swipe = swipesBack(c.feel) && screens.length + c.pending.length > 1;
  if (swipe) out.push(...swipeCode(c.feel, c, c.tap || c.routes), "");
  if (c.routes) out.push(...routeRoot(c, screens, start, swipe));
  else {
    const visit = `{ position: "absolute", inset: 0, overflowX: "hidden", overflowY: "auto" }`;
    out.push(
      "interface Nav {",
      "  /** Bumps on every move, so each visit is its own element that can enter and leave. */",
      "  visit: number;",
      "  screen: ScreenId;",
      "  /** How it was gone to, the last time it was (not by going back): a pushed screen pops the way it came. */",
      `  came?: Via["kind"];`,
      "  /** The screens before it, and how each was gone to. */",
      `  history: { screen: ScreenId; came?: Via["kind"] }[];`,
      "  via?: Via;",
      "  /** Shared layers match within a group: smart transitions stay in it, other kinds start a new one. */",
      "  group: number;",
      "}",
      "",
      "/** Go to another screen, or back to the one before. */",
      "function move(n: Nav, to: ScreenId | \"back\", via: Via): Nav {",
      `  const back = to === "back";`,
      "  const prev = n.history[n.history.length - 1];",
      "  if (back && !prev) return n;",
      "  const screen = back ? prev.screen : to;",
      "  return {",
      "    visit: n.visit + 1,",
      "    screen,",
      "    came: back ? prev.came : via.kind,",
      "    history: back ? n.history.slice(0, -1) : [...n.history, { screen: n.screen, came: n.came }],",
      "    via: { ...via, back, dir: SCREENS[screen].dir },",
      `    group: via.kind === "smart" ? n.group : n.group + 1,`,
      "  };",
      "}",
      ...(swipe ? ["", "/** Back by a swipe: the platform's pop. */", `const BACK: Via = { kind: "push" };`, "", "const VISIT: CSSProperties = " + visit + ";"] : []),
      "",
      `export default function Prototype({ start = ${lit(start.key)} }: { start?: ScreenId }) {`,
      "  const [nav, setNav] = useState<Nav>({ visit: 0, screen: start, history: [], group: 0 });",
      "  const reduced = useReducedMotion() ?? false;",
      "  const go = useCallback((to: ScreenId | \"back\", via: Via) => setNav((n) => move(n, to, via)), []);",
      ...(swipe ? ["  // As in UIKit, a screen swipes back once it has come in.", "  const arrived = useRef(nav.visit);"] : []),
      "  const { Screen, width, height } = SCREENS[nav.screen];",
      "  const via = calm(nav.via, reduced);",
      ...(swipe ? swipeWiring() : []),
      "  return (",
      `    <div${swipe ? " onPointerDown={swipe.onPointerDown}" : ""} style={{ position: "relative", width, height, overflow: "hidden", isolation: "isolate"${swipe ? ", ...(swipe.on ? SWIPING : {})" : ""} }}>`,
      "      <style>{qalamCSS}</style>",
      `      <MotionConfig transition={via?.transition ?? MOTION.morph} reducedMotion="user">`,
      "        <AnimatePresence initial={false} custom={via}>",
      ...(swipe ? swipeUnder(c, "<Under go={go} via={under.via} />") : []),
      "          <motion.div",
      "            key={nav.visit}",
      "            custom={via}",
      "            variants={screenVariants}",
      `            initial={via?.kind === "smart" ? "smart" : "enter"}`,
      `            animate="center"`,
      `            exit="exit"`,
      "            layoutScroll",
      ...(swipe ? ARRIVED : []),
      `            style={${swipe ? "{ ...VISIT, ...(swipe.on ? { x: swipe.x } : {}) }" : visit}}`,
      "          >",
      "            <LayoutGroup id={`flow-${nav.group}`}>",
      "              <Screen go={go} via={nav.via} />",
      "            </LayoutGroup>",
      "          </motion.div>",
      "        </AnimatePresence>",
      "      </MotionConfig>",
      "    </div>",
      "  );",
      "}",
      "",
    );
  }
  // Imports gathered while emitting the screens.
  out[out.findIndex((l) => l.endsWith(`from "react";`))] = `import { ${sorted(c.react).join(", ")} } from "react";`;
  out[out.findIndex((l) => l.endsWith(`from "motion/react";`))] = `import { ${sorted(c.motion).join(", ")} } from "motion/react";`;
  return { code: out.join("\n"), screens, start: start.id, warnings, feel: c.feel };
}

/**
 * <Prototype />'s swipe back (feel.ts useSwipeBack), where it may start: the screen was pushed, has
 * come in and has one before it (and `also` holds). The screen before is worked out as Back would
 * leave it, so it shows under this one as it was left; closing, the swipe goes back to it.
 */
const swipeWiring = (also?: string) => [
  "  // Swiping back: while the screen is pulled away, the one before shows under it as it was left, and becomes the screen once the swipe closes.",
  `  const back = nav.history.length ? move(nav, "back", BACK) : null;`,
  "  const swipe = useSwipeBack(",
  "    width,",
  `    !!back && SCREENS[back.screen].dir === "rtl",`,
  `    () => !!back && nav.came === "push" && arrived.current === nav.visit${also ? ` && ${also}` : ""},`,
  `    () => setNav((n) => (n.visit === nav.visit ? move(n, "back", BACK) : n)),`,
  "  );",
  "  const under = swipe.on ? back : null;",
  "  const Under = under ? SCREENS[under.screen].Screen : null;",
];

/**
 * The screen before, under the one being swiped away: keyed as the visit going back makes, so when
 * the swipe closes it is that visit already, where the swipe left it, and nothing jumps.
 */
const swipeUnder = (c: Ctx, screen: string) => [
  "          {under && Under && (",
  `            <motion.div key={under.visit} initial={false} layoutScroll${c.preview ? ` data-qscroller=""` : ""} style={{ ...VISIT, x: swipe.under, filter: swipe.dim }}>`,
  "              <LayoutGroup id={`flow-${under.group}`}>",
  `                ${screen}`,
  "              </LayoutGroup>",
  "            </motion.div>",
  "          )}",
];

/** The visit has come in (the platform's change of screen has settled): it may be swiped back now. */
const ARRIVED = [
  "            onAnimationComplete={(d) => {",
  `              if (d === "center") arrived.current = nav.visit;`,
  "            }}",
];

/**
 * The module's end for a prototype with routes: each screen's parts, the navigation step and the
 * overlay layer (overlays.ts), and <Prototype />, which keeps which parts are open on each visit,
 * draws the overlays over the viewport, and takes Escape as Back while one that Back closes is open.
 */
function routeRoot(c: Ctx, screens: CompiledScreen[], start: CompiledScreen, swipe: boolean): string[] {
  const out: string[] = [
    "",
    "/** Each screen's parts: what its rules open, close and show. */",
    "export const PARTS: Partial<Record<ScreenId, Record<string, PartDef>>> = {",
  ];
  for (const s of screens) {
    const parts = c.parts.get(s.id) ?? [];
    if (!parts.length) continue;
    out.push(`  ${key(s.key)}: {`);
    for (const p of parts) {
      const d = p.def;
      const bits = [`Part: ${p.component}`, `kind: ${lit(p.kind)}`, `dismiss: [${(d?.dismiss ?? []).map(lit).join(", ")}]`, `width: ${p.w}`];
      if (d?.detent) bits.push(`detent: ${lit(d.detent)}`);
      if (d?.ms) bits.push(`ms: ${d.ms}`);
      out.push(`    ${key(p.part)}: { ${bits.join(", ")} },`);
    }
    out.push("  },");
  }
  out.push(
    "};",
    "",
    "/** Back from a rule: the platform's pop. */",
    `const BACK: Via = { kind: "push" };`,
    ...dataModule(c, screens, c.rds),
    "",
    ...NAV_STEP,
    "",
    ...overlayCode(c.feel, c),
    "",
    "export interface PrototypeProps {",
    "  start?: ScreenId;",
    "  /** Where to begin instead: a state worked out ahead (a step of a walkthrough), and how far its screen is scrolled. */",
    "  from?: { state: State; y?: number };",
    "  /** Told each time the prototype moves. */",
    "  onChange?: (s: State) => void;",
    "}",
    "",
    ...(swipe
      ? [
          "/** Each visit is its own stacking context: what's pinned in it stays under the overlays. */",
          `const VISIT: CSSProperties = { position: "absolute", inset: 0, overflowX: "hidden", overflowY: "auto", isolation: "isolate" };`,
          "",
        ]
      : []),
    `export default function Prototype({ start = ${lit(start.key)}, from, onChange }: PrototypeProps) {`,
    "  const [nav, setNav] = useState<State>(() => from?.state ?? initial(start));",
    "  const reduced = useReducedMotion() ?? false;",
    "  const device = useRef<HTMLDivElement>(null);",
    "  const scroller = useRef<HTMLElement | null>(null);",
    "  const current = useRef(nav);",
    "  current.current = nav;",
    ...(swipe ? ["  // As in UIKit, a screen swipes back once it has come in.", "  const arrived = useRef(nav.visit);"] : []),
    "  const changed = useRef(onChange);",
    "  changed.current = onChange;",
    "  useEffect(() => changed.current?.(nav), [nav]);",
    "  // Begun part way: the screen is where it was scrolled to.",
    "  const begun = useRef(from);",
    "  useEffect(() => {",
    "    if (begun.current?.y) scroller.current?.scrollTo({ top: begun.current.y });",
    "  }, []);",
    "  // A link back closes what's open on the screen first, like a rule's Back.",
    "  const go = useCallback((to: ScreenId | \"back\", via: Via) => setNav((n) => (to === \"back\" && topOverlay(n) ? step(n, { do: \"close\" }) : move(n, to, via))), []);",
    "  const act = useCallback((a: Action, e?: TapEvent) => {",
    "    const el = e?.currentTarget instanceof Element ? e.currentTarget : null;",
    "    const d = device.current?.getBoundingClientRect();",
    "    const r = el?.getBoundingClientRect();",
    "    const anchor = d && r ? { x: r.left - d.left, y: r.top - d.top, w: r.width, h: r.height } : undefined;",
    "    setNav((n) => step(n, a, anchor));",
    "  }, []);",
    "  // Escape is Back while an overlay that Back closes is open.",
    "  useEffect(() => {",
    "    const onKey = (e: globalThis.KeyboardEvent) => {",
    "      const n = current.current;",
    "      const top = topOverlay(n);",
    "      if (e.key !== \"Escape\" || !top || !PARTS[n.screen]?.[top]?.dismiss.includes(\"back\")) return;",
    "      e.preventDefault();",
    "      e.stopPropagation();",
    "      setNav((m) => step(m, { do: \"back\" }));",
    "    };",
    "    window.addEventListener(\"keydown\", onKey, true);",
    "    return () => window.removeEventListener(\"keydown\", onKey, true);",
    "  }, []);",
    "  // A rule asked to scroll (a chip to its section): the screen scrolls there, smoothly.",
    "  useEffect(() => {",
    "    if (nav.scrollTo) scroller.current?.scrollTo({ top: nav.scrollTo.y, behavior: \"smooth\" });",
    "  }, [nav.scrollTo]);",
    "  const { Screen, width, height } = SCREENS[nav.screen];",
    "  const via = calm(nav.via, reduced);",
    ...(swipe ? swipeWiring("!topOverlay(nav)") : []),
    "  return (",
    `    <div ref={device}${swipe ? " onPointerDown={swipe.onPointerDown}" : ""} style={{ position: "relative", width, height, overflow: "hidden", isolation: "isolate"${swipe ? ", ...(swipe.on ? SWIPING : {})" : ""} }}>`,
    "      <style>{qalamCSS}</style>",
    `      <MotionConfig transition={via?.transition ?? MOTION.morph} reducedMotion="user">`,
    "        <AnimatePresence initial={false} custom={via}>",
    ...(swipe ? swipeUnder(c, "<Under go={go} via={under.via} act={act} open={under.open} s={under} />") : []),
    "          <motion.div",
    "            key={nav.visit}",
    "            ref={(el: HTMLDivElement | null) => {",
    "              if (el) scroller.current = el;",
    "            }}",
    "            custom={via}",
    "            variants={screenVariants}",
    `            initial={via?.kind === "smart" ? "smart" : "enter"}`,
    `            animate="center"`,
    `            exit="exit"`,
    "            layoutScroll",
    ...(c.preview ? ["            data-qscroller=\"\""] : []),
    "            onScroll={(e) => act({ do: \"scrolled\", y: e.currentTarget.scrollTop, max: e.currentTarget.scrollHeight - e.currentTarget.clientHeight })}",
    ...(swipe
      ? [...ARRIVED, "            style={{ ...VISIT, ...(swipe.on ? { x: swipe.x } : {}) }}"]
      : ["            // Each visit is its own stacking context: what's pinned in it stays under the overlays.", `            style={{ position: "absolute", inset: 0, overflowX: "hidden", overflowY: "auto", isolation: "isolate" }}`]),
    "          >",
    "            <LayoutGroup id={`flow-${nav.group}`}>",
    "              <Screen go={go} via={nav.via} act={act} open={nav.open} s={nav} />",
    "            </LayoutGroup>",
    "          </motion.div>",
    "        </AnimatePresence>",
    "        <Overlays s={nav} size={{ width, height }} act={act} reduced={reduced} />",
    "      </MotionConfig>",
    "    </div>",
    "  );",
    "}",
    "",
  );
  return out;
}

const PENDING_TITLE = { fontFamily: "Inter", fontSize: 20, fontWeight: 700, lineHeight: 28, letterSpacing: 0 };
const PENDING_BODY = { fontFamily: "Inter", fontSize: 13, fontWeight: 400, lineHeight: 18, letterSpacing: 0 };

/** A page not designed yet: its name, that it isn't designed yet, and the way back. */
function pendingScreen(c: Ctx, p: PendingPage): string[] {
  const rtl = p.owner.dir === "rtl";
  const title = c.t.type("type.title", PENDING_TITLE).className;
  const body = c.t.type("type.body", PENDING_BODY).className;
  c.icons.add("ArrowLeftIcon");
  return [
    `/** ${p.name.replace(/\*\//g, "")}: not designed yet (${p.owner.name.replace(/\*\//g, "")} goes on to it). */`,
    `function ${p.component}({ go }: ScreenProps) {`,
    "  return (",
    `    <div className="q-screen" dir=${lit(p.owner.dir)} style={{ width: "100%", minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 32, textAlign: "center", background: "var(--bg-canvas, #ffffff)", color: "var(--text-primary, #1c1c1c)" }}${c.preview ? ` data-qscreen=${lit(p.key)} data-qpending=${lit(p.page)}` : ""}>`,
    `      <button type="button" aria-label=${lit(rtl ? "رجوع" : "Back")} onClick={() => go("back", BACK)} style={{ position: "absolute", top: 52, insetInlineStart: 16, width: 44, height: 44, display: "grid", placeItems: "center", border: 0, borderRadius: 22, background: "transparent", color: "inherit", cursor: "pointer" }}>`,
    `        <ArrowLeftIcon size={24}${rtl ? ` style={{ transform: "scaleX(-1)" }}` : ""} />`,
    "      </button>",
    `      <p className=${lit(title)}>{${lit(p.name)}}</p>`,
    `      <p className=${lit(body)} style={{ color: "var(--text-secondary, #6b6b6b)" }}>{${lit(rtl ? "لم تُصمَّم بعد" : "Not designed yet")}}</p>`,
    "    </div>",
    "  );",
    "}",
  ];
}
