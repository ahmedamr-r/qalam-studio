// ---------------------------------------------------------------------------
// Prototype: a small declarative motion layer over the screens. Qalam AI only chooses (links,
// presets, motion tokens); codegen/ compiles it to code. Everything points at screens by root id
// and at component instances by their spec path (meta.specPath), which survive rebuilds.

/** A screen (root frame id), or a component instance in it by spec path ("body.1"). */
export interface ProtoRef {
  screen: string;
  /** Absent: the whole screen. Tracks may use one-segment wildcards ("body.*" = every body section). */
  path?: string;
}

/** tap: click/tap. press: as soon as the pointer goes down. hover: the pointer enters (a state reverts when it leaves). delay: `after` ms once the screen is showing. */
export type ProtoTrigger = "tap" | "press" | "hover" | "delay";

/** smart: instances that match across the two screens morph (shared layout); the rest dissolves. */
export type ProtoTransitionKind = "smart" | "push" | "dissolve" | "sheet";

/**
 * How something moves: "native" moves it as the platform does (design-system/native-motion.ts: iOS,
 * Android or the web), or a motion token (design-system/motion.ts): "spring.gentle", "medium.standard"…
 */
export type MotionRef = "native" | "fast.standard" | "fast.emphasized" | "medium.standard" | "medium.emphasized" | "slow.standard" | "slow.emphasized" | "spring.gentle" | "spring.snappy";

export interface ProtoTransition {
  kind: ProtoTransitionKind;
  motion: MotionRef;
}

export interface ProtoLink {
  from: ProtoRef;
  on: ProtoTrigger;
  /** For delay: ms after the screen appears. */
  after?: number;
  /** Another screen, one of this screen's states ("default" is the one it opens in), or the previous screen. */
  to: { screen: string } | { state: string } | "back";
  /** State changes animate in place with its motion; `kind` applies to screen changes. */
  transition: ProtoTransition;
}

/** A named state of a screen: instance props it overrides, keyed "<specPath>.props.<prop>", e.g. { "body.1.props.current": 3 }. */
export type ProtoStateDiff = Record<string, unknown>;

export type TrackPreset = "fade-up" | "scale-in" | "pulse" | "shimmer";

/** In-screen choreography, played when the screen appears (pulse and shimmer loop). */
export interface ProtoTrack {
  target: ProtoRef;
  preset: TrackPreset;
  /** ms between consecutive targets a wildcard matches. */
  stagger?: number;
  motion: MotionRef;
}

export interface Prototype {
  /** The screen Prototype mode opens on; the first linked screen when absent. */
  start?: string;
  links: ProtoLink[];
  /** Root id → state name → diff. */
  states: Record<string, Record<string, ProtoStateDiff>>;
  tracks: ProtoTrack[];
  /** Explicit smart-animate match keys (root id → spec path → key); otherwise instances match by component and order. */
  keys?: Record<string, Record<string, string>>;
  /** What happens on each screen without leaving it (root id → its route): see RouteProto. */
  routes?: Record<string, RouteProto>;
  /** What the app remembers across screens (a basket), read as "app.<name>". */
  vars?: Record<string, VarDef>;
  /** Alternatives Generate drew for one screen: takes of one route, the chosen one holding it. */
  takes?: TakeGroup[];
  /** How phone screens move when they move natively: iOS (absent) or Android. Web screens move as the web does. */
  feel?: "ios" | "android";
}

/** Takes of one screen, in the order they were drawn: the chosen one is the route; the rest wait (or are tucked away). */
export interface TakeGroup {
  frames: string[];
  chosen: string;
  /** The others are tucked behind the chosen one, off the canvas. */
  collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Routes: a screen and everything that happens on it without leaving it. The Back test decides
// what belongs: whatever Back would close (a sheet, a dialog, a menu) or that keeps you on the page
// is the route's; whatever opens a new page is another route. A route's overlays and add-ons are
// frames of their own beside the screen (each built from a spec with a `surface`), so they are
// designed like screens; this layer only says which frames belong to which screen and what opens
// and closes them. Ownership lives here, never in a frame's meta (a copied frame isn't a part).

/** A place in a route: the screen, or one of its parts, and a component in it by spec path. */
export interface RouteRef {
  /** One of the route's overlays or add-ons, by its part id; absent: the screen itself. */
  part?: string;
  /**
   * The component's spec path in that frame ("body.1.children.0"); absent: the whole frame. A
   * pattern ("body.*.children.*.children.1") points at the same element in every item of a
   * collection: a rule on it runs with that item.
   */
  path?: string;
  /** A layer inside the component, by role: a chip, a stepper's + or −, a top bar's buttons. */
  sub?: SubRef;
}

/** Layers inside a component that can be tapped on their own (proto/parts.ts finds them). */
export interface SubRef {
  role: "option" | "increase" | "decrease" | "leading" | "trailing" | "action";
  /** Which one (chips, tabs, segments, actions in reading order); absent: each one, by its index. */
  nth?: number;
}

// ---------------------------------------------------------------------------
// Data: what a prototype remembers, and what reads it. The model never writes these: recipes do
// (proto/recipes), from what code finds on the screen. Money is in minor units (cents, fils).

/** A value kept on a screen while you're on it (route scope) or across the app ("app.<name>"). */
export type VarType =
  | { t: "bool" }
  | { t: "int"; min: number; max: number }
  | { t: "money" }
  | { t: "text"; max: number }
  /** An item id from a collection, or null. */
  | { t: "choice"; of: string }
  /** Item ids from a collection. */
  | { t: "set"; of: string }
  /** Records: a basket's lines. */
  | { t: "list"; fields: Record<string, ListField> };
export type ListField = "text" | "int" | "money";
export type ListRecord = Record<string, string | number>;
export type Value = string | number | boolean | null | string[] | ListRecord[];

export interface VarDef {
  type: VarType;
  init: Value;
  /** What it holds, for people ("Basket", "Chosen size"). */
  label: string;
  /** Starts over each time this part opens (a sheet's choices). */
  resetOn?: string;
}

export type BinOp = "+" | "-" | "*" | "min" | "max" | "and" | "or" | "==" | "!=" | "<" | "<=" | ">" | ">=";

/**
 * A value worked out from what the prototype remembers (closed JSON: no strings evaluated).
 * Reads: a var (`v`: "qty", "app.basket"), a field of the item an element belongs to (`it`), of
 * the item the open part is about (`ctx`), of the element being counted or summed (`el`).
 */
export type Expr =
  | string
  | number
  | boolean
  | null
  | { v: string }
  | { it: string }
  | { ctx: string }
  | { el: string }
  /** An amount of money, in minor units: read off the design by code, never written by the model. */
  | { money: number }
  | { op: BinOp; a: Expr[] }
  | { op: "not"; a: [Expr] }
  | { op: "if"; a: [Expr, Expr, Expr] }
  | { op: "count" | "sum"; of: { v: string } | { items: string }; where?: Expr; value?: Expr }
  | { op: "has"; set: Expr; a: Expr }
  | { op: "get"; of: string; id: Expr; field: string }
  /** The titles of items of a collection, by id (one, or a set's): "Large", "Garlic sauce, Cheese". */
  | { op: "titles"; of: string; ids: Expr }
  /** Texts joined, the empty ones left out ("Large · Garlic sauce"). */
  | { op: "join"; a: Expr[]; sep: string };

/** Repeated elements that read as items (dishes, ride types, sizes): records come from their content, by code. */
export interface Collection {
  label: string;
  /** A pattern for its elements ("body.*.children.*"), in the screen or one of its parts. */
  of: RouteRef;
  /** Only elements of this component (a pattern can also match the dividers between them). */
  component?: string;
}

/** A live value in authored copy: what it replaces is found by its format ("AED 18.00" for money). */
export interface Slot {
  e: Expr;
  fmt: "text" | "int" | "money";
  /** The copy it stands in for when that's part of the text (the picked ride in "Book Economy · AED 18.00"); without it, a text slot is all of it. */
  at?: string;
}

export type Binding =
  /** The component's copy, with slots that follow values ("Add · {total}"). */
  | { kind: "text"; ref: RouteRef; slots: Record<string, Slot> }
  /** One of its props follows a value (checked, selected, disabled, scrolled). */
  | { kind: "prop"; ref: RouteRef; prop: string; e: Expr }
  /** It shows only while a value holds. */
  | { kind: "visible"; ref: RouteRef; e: Expr }
  /**
   * It's drawn once for each element of a list (`of`: "app.basket"), what's inside it reading the
   * element (`{ el: "title" }`); the design's other sample rows (`others`, spec paths) and the
   * dividers between them make way.
   */
  | { kind: "repeat"; ref: RouteRef; of: string; others?: string[] };

/** While `when` holds, the component at `ref` shows as `inst` (a + that becomes the count in the basket). */
export interface SwapDef {
  label: string;
  ref: RouteRef;
  when: Expr;
  inst: { component: string; props?: Record<string, unknown>; children?: unknown[] };
  /** Live values in the swapped component's copy ("{qty}"). */
  slots?: Record<string, Slot>;
}

export type ScrollEffect =
  /** `v` turns true once the content has scrolled past the element (under the pinned top). */
  | { kind: "past"; ref: RouteRef; v: string }
  /** The element sticks under the pinned top while its section scrolls. */
  | { kind: "stick"; ref: RouteRef }
  /** `v` is the section in view (an item id of `items`). */
  | { kind: "spy"; items: string; v: string };

/** Frames built from a spec with a surface: overlays a screen opens, and add-ons it shows in a region. */
export type SurfaceKind = "sheet" | "dialog" | "toast" | "menu" | "bar";
export type OverlayKind = "sheet" | "dialog" | "toast" | "menu";

/** Ways an overlay closes on its own: tapping the scrim, dragging it away, Back, or a timer (toasts). */
export type Dismiss = "scrim" | "drag" | "back" | "timer";

export interface OverlayDef {
  /** The frame drawn for it: a top-level frame beside the screen, its spec's surface = kind. */
  frame: string;
  kind: OverlayKind;
  dismiss: Dismiss[];
  /** Sheets: as tall as their content, or the screen's full height. */
  detent?: "content" | "full";
  /** Menus: the component they open from. */
  anchor?: RouteRef;
  /** Toasts: how long they show, in ms. */
  ms?: number;
}

/** A bar the screen shows in a region: while `when` holds, else while a rule has it open. */
export interface AddOnDef {
  frame: string;
  region: "bottom" | "top";
  /** Shown while this holds (a basket bar once something is in the basket). */
  when?: Expr;
}

export type RouteTrigger = { on: "tap" | "press" | "hover"; ref: RouteRef } | { on: "enter" } | { on: "delay"; ms: number };

export type RouteAction =
  /** Show an overlay or an add-on (by part id); `item`: the item it's about (a dish's options). */
  | { do: "open"; part: string; item?: Expr }
  | { do: "set"; v: string; e: Expr }
  /** Add `by` to a number (kept within its range). */
  | { do: "inc"; v: string; by: number }
  /** Flip a bool, or put an item in / take it out of a set. */
  | { do: "toggle"; v: string; id?: Expr }
  /** Add a record to a list (a line in the basket). */
  | { do: "push"; v: string; record: Record<string, Expr> }
  /** Change a field of the list's element the tapped layer is drawn for (a line's quantity); below `min` it leaves the list. */
  | { do: "change"; v: string; field: string; by: number; min?: number }
  | { do: "remove"; v: string; where: Expr }
  /** Scroll so an item (a section) sits under the pinned top. */
  | { do: "scrollTo"; items: string; id: Expr }
  /** Close one; absent: the topmost overlay. */
  | { do: "close"; part?: string }
  /** Back: closes the topmost overlay first, then returns to the screen before. */
  | { do: "back" }
  /** Another screen (a new page: another route). */
  | { do: "go"; screen: string; transition: ProtoTransition }
  /** A page that isn't designed yet (one of the route's `next`): a placeholder until Generate draws it. */
  | { do: "next"; page: string; transition: ProtoTransition };

export interface RouteRule {
  /** Stable within the route ("r1"): steps and the Prototype tab point at it. */
  id: string;
  when: RouteTrigger;
  /** Runs only while this holds (Add once a size is chosen). */
  if?: Expr;
  /**
   * When the trigger is a set of layers (every chip, every dish's +), the n-th runs with the n-th
   * item of this collection; without it, a layer runs with the item it's inside.
   */
  each?: string;
  then: RouteAction[];
}

export interface RouteProto {
  /** Part id → overlay. Part ids are short and stable within the route ("options", "filters"). */
  overlays: Record<string, OverlayDef>;
  addOns: Record<string, AddOnDef>;
  rules: RouteRule[];
  /** What the screen remembers while you're on it. */
  vars?: Record<string, VarDef>;
  /** Its collections of items, by id ("dishes", "sizes"). */
  items?: Record<string, Collection>;
  bindings?: Binding[];
  swaps?: SwapDef[];
  scroll?: ScrollEffect[];
  /** What it does, step by step as it was built (by a recipe, by Qalam AI), each with a walkthrough. */
  steps?: RouteStep[];
  /**
   * What the designer asked to see happen on the screen that wasn't drawn (a sheet open, something
   * added), in their words: queued by Generate for Qalam AI to propose, until a build takes them.
   */
  asks?: string[];
  /** Pages it goes to that aren't designed yet, by id ("basket"): Generate draws each from what leads there. */
  next?: Record<string, NextPage>;
}

/** A page a screen goes to before it's designed: what it is, for the canvas, the prototype and Generate. */
export interface NextPage {
  /** As a screen's name ("Basket"). */
  name: string;
  /** What it shows, in a line ("The dishes added with their options, the total, Checkout"). */
  brief: string;
}

/** What the cursor does in a step's walkthrough. */
export type PlayAction =
  /** Tap it: what the prototype does then is the step's to show. */
  | { do: "tap"; ref: RouteRef }
  /** Scroll the screen to `y` (0: the top). */
  | { do: "scroll"; y: number }
  /** Rest on it: what changed is shown, not touched. */
  | { do: "look"; ref: RouteRef };

/** Something a screen does, as built: what it's called, where its marker sits, and a walkthrough that shows it (played after the steps before it). */
export interface RouteStep {
  /** Stable within the route ("s1"). */
  id: string;
  /** The recipe it came from ("chooseOne"). */
  recipe: string;
  label: string;
  /** What you'd touch first: its marker sits there. */
  at?: RouteRef;
  play: PlayAction[];
}
