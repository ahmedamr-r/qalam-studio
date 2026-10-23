import { icons as LUCIDE } from "lucide";
import LUCIDE_NAMES from "./lucide-names.json";

/**
 * Icons: generated screens and the component catalog name them by Lucide's kebab-case names ("x",
 * "arrow-left", "map-pin"), the whole Lucide library (lucide.dev). A design system draws them from
 * its icon set: Lucide (the default) or Hugeicons (hugeicons.com, the free stroke-rounded set),
 * which gets each name's Hugeicons counterpart. Names are resolved forgivingly (aliases, other
 * casings, React Icons' "LuArrowLeft"), and a name that isn't an icon gets the closest real ones
 * as suggestions, so the self-check can fix it.
 * lucide-names.json lists Lucide's canonical names (node scripts/lucide-names.mjs); the Hugeicons
 * data is public/icons/hugeicons.json (npx tsx scripts/hugeicons.mts), fetched when first needed.
 */

export type IconShape = [string, Record<string, string | number>][];

const SHAPES = LUCIDE as unknown as Record<string, IconShape>;

/** Every icon in the library, by its canonical name (for pickers). */
export const ICON_NAMES: string[] = LUCIDE_NAMES;

/**
 * The studio's short names from before it had the whole library, for names Lucide doesn't have
 * (or only as an alias of something else). Specs, design-system docs and recordings use them.
 * Lucide's own names always mean Lucide's icon.
 */
export const STUDIO_NAMES: Record<string, string> = {
  close: "x",
  more: "ellipsis-vertical",
  help: "circle-question-mark",
  alert: "triangle-alert",
  home: "house",
  filter: "funnel",
  message: "message-circle",
  cart: "shopping-cart",
  sliders: "sliders-horizontal",
  audio: "audio-lines",
  grid: "layout-grid",
};

/** Names from other icon sets and plain words that models and people reach for. */
const SYNONYMS: Record<string, string> = {
  cross: "x",
  times: "x",
  cancel: "x",
  dismiss: "x",
  back: "arrow-left",
  forward: "arrow-right",
  add: "plus",
  remove: "minus",
  delete: "trash",
  edit: "pencil",
  gear: "settings",
  cog: "settings",
  profile: "user",
  account: "user",
  person: "user",
  notification: "bell",
  notifications: "bell",
  location: "map-pin",
  pin: "map-pin",
  "more-horizontal": "ellipsis",
  "more-vertical": "ellipsis-vertical",
  "dots-horizontal": "ellipsis",
  "dots-vertical": "ellipsis-vertical",
  kebab: "ellipsis-vertical",
  hamburger: "menu",
  "exclamation-triangle": "triangle-alert",
  warning: "triangle-alert",
  error: "circle-alert",
  success: "circle-check",
  question: "circle-question-mark",
  "info-circle": "info",
  visibility: "eye",
  "visibility-off": "eye-off",
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const CANONICAL_NAMES = new Set<string>(LUCIDE_NAMES);
/** Every Lucide key (canonical and alias), by its squashed name: "arrow-down-a-z" and "ArrowDownAZ" meet. */
const KEY_BY_SQUASH = new Map(Object.keys(SHAPES).map((k) => [k.toLowerCase(), k]));
/** Canonical name of each icon (aliases share the canonical one's shape). */
const CANONICAL = new Map<IconShape, string>();
for (const name of LUCIDE_NAMES) {
  const key = KEY_BY_SQUASH.get(squash(name));
  if (key) CANONICAL.set(SHAPES[key], name);
}

function lucideName(raw: string): string | null {
  const key = KEY_BY_SQUASH.get(squash(raw));
  return key ? (CANONICAL.get(SHAPES[key]) ?? null) : null;
}

/**
 * The canonical Lucide name for any way of writing an icon, or null if it isn't in the library.
 * Lucide's names come first, then the studio's short names, then aliases and other spellings.
 */
export function resolveIcon(name: string): string | null {
  const n = String(name ?? "").trim();
  if (!n) return null;
  const lower = n.toLowerCase();
  if (CANONICAL_NAMES.has(lower)) return lower;
  if (STUDIO_NAMES[lower]) return STUDIO_NAMES[lower];
  const direct = lucideName(n);
  if (direct) return direct;
  // "lucide:arrow-left", "lucide-arrow-left", React Icons' LuArrowLeft / FiArrowLeft (Feather, Lucide's origin).
  const bare = n.replace(/^(lucide[:-]|icon[:-])/i, "").replace(/^(Lu|Fi)(?=[A-Z])/, "");
  const trimmed = bare
    .replace(/([-_ ]?(icon|outline|outlined|line|stroke|regular))$/i, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  // Numbered variants from other sets ("home-01", "notification-03") name the plain icon.
  const plain = trimmed.replace(/-\d{2}$/, "");
  const word = (w: string) => lucideName(w) ?? STUDIO_NAMES[w] ?? (SYNONYMS[w] ? lucideName(SYNONYMS[w]) : null);
  return lucideName(bare) ?? word(trimmed) ?? (plain !== trimmed ? word(plain) : null);
}

/** The Lucide shape for a name, or null if it isn't a Lucide icon. */
export function iconShape(name: string): IconShape | null {
  const n = resolveIcon(name);
  const key = n ? KEY_BY_SQUASH.get(squash(n)) : undefined;
  return key ? SHAPES[key] : null;
}

/**
 * The Lucide component (PascalCase, as lucide-react exports it) for a stored icon name. A
 * Hugeicons name ("hugeicons:cancel-01") gets what it means in Lucide. Null when there is none.
 */
export function lucideComponent(name: string): string | null {
  const raw = String(name ?? "").startsWith("hugeicons:") ? name.slice("hugeicons:".length) : name;
  const n = resolveIcon(raw);
  return (n && KEY_BY_SQUASH.get(squash(n))) ?? null;
}

/** A Lucide component's shape by its PascalCase name ("MessageCircle"). */
export const lucideShape = (component: string): IconShape | null => SHAPES[component] ?? null;

// ---------------------------------------------------------------------------
// Icon sets

export type IconSet = "lucide" | "hugeicons";

export const ICON_SETS: Record<IconSet, { label: string; site: string; strokeWidth: number; blurb: string }> = {
  lucide: { label: "Lucide", site: "lucide.dev", strokeWidth: 2, blurb: `${LUCIDE_NAMES.length} icons · 2px strokes` },
  hugeicons: { label: "Hugeicons", site: "hugeicons.com", strokeWidth: 1.5, blurb: "6,000+ icons · 1.5px rounded strokes" },
};
export const ICON_SET_IDS = Object.keys(ICON_SETS) as IconSet[];
export const isIconSet = (v: unknown): v is IconSet => v === "lucide" || v === "hugeicons";

/** Where a design system's tree records its icon set (a DTCG extension on the root). */
export const ICON_SET_EXTENSION = "qalam.iconSet";

/** A Hugeicons name is stored with its set ("hugeicons:cancel-01"); Lucide names are bare. */
const HUGE = "hugeicons:";
export const iconSetOfName = (name: string): IconSet => (name.startsWith(HUGE) ? "hugeicons" : "lucide");
/** A stored name as shown to people ("hugeicons:cancel-01" → "cancel-01"). */
export const bareIcon = (name: string) => (name.startsWith(HUGE) ? name.slice(HUGE.length) : name);

type HugeEntry = string | [string, string] | [string, string, 1];
export interface HugeiconsData {
  version: string;
  strokeWidth: number;
  /** Stroke path data, or [stroke, fill] (with 1 when the fill is even-odd). */
  icons: Record<string, HugeEntry>;
  aliases: Record<string, string>;
}

let huge: HugeiconsData | null = null;
let hugeNames: string[] = [];
const hugeBySquash = new Map<string, string>();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const drawings = new Map<string, IconDrawing | null>();

/** Install the Hugeicons data (fetched in the browser; read from disk in tests and scripts). */
export function setHugeicons(data: HugeiconsData) {
  huge = data;
  hugeNames = Object.keys(data.icons).sort();
  hugeBySquash.clear();
  for (const [alias, name] of Object.entries(data.aliases)) hugeBySquash.set(squash(alias), name);
  // A canonical name always means its own icon.
  for (const name of hugeNames) hugeBySquash.set(squash(name), name);
  drawings.clear();
  for (const fn of listeners) fn();
}

export const iconSetReady = (set: IconSet) => set === "lucide" || !!huge;

/** Load an icon set's data before building or drawing with it (Lucide is always there). */
export function ensureIconSet(set: IconSet): Promise<void> {
  if (iconSetReady(set)) return Promise.resolve();
  loading ??= fetch("/icons/hugeicons.json")
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load Hugeicons (HTTP ${r.status}).`);
      return r.json();
    })
    .then(setHugeicons)
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Call `fn` when an icon set finishes loading; returns the unsubscribe. */
export function onIconSetLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Every icon in a set, by canonical name (Hugeicons: empty until loaded). */
export const iconNamesFor = (set: IconSet): string[] => (set === "hugeicons" ? hugeNames : ICON_NAMES);

/** A name's Hugeicons counterpart: its own name or alias, its "-01" variant, or by way of what the name means in Lucide. */
function hugeiconFor(name: string): string | null {
  if (!huge) return null;
  // Studio short names mean what they always drew ("more" is the vertical ellipsis).
  const raw = bareIcon(String(name ?? "").trim());
  const bare = STUDIO_NAMES[raw.toLowerCase()] ?? raw;
  const find = (n: string) => hugeBySquash.get(squash(n)) ?? hugeBySquash.get(`${squash(n)}01`) ?? null;
  const direct = find(bare);
  if (direct) return direct;
  const lucide = resolveIcon(bare);
  if (!lucide) return null;
  const viaLucide = find(lucide);
  if (viaLucide) return viaLucide;
  // Lucide's older names for the same icon ("alert-triangle" for triangle-alert).
  const shape = SHAPES[KEY_BY_SQUASH.get(squash(lucide))!];
  for (const [key, s] of Object.entries(SHAPES)) if (s === shape && key.toLowerCase() !== squash(lucide)) {
    const hit = find(key);
    if (hit) return hit;
  }
  return null;
}

/**
 * The name to store for an icon drawn from a set, or null if it isn't an icon at all. A Hugeicons
 * system falls back to the Lucide icon where Hugeicons has no counterpart. While Hugeicons is still
 * loading, the name is kept as written (with its set) and resolved when it's drawn.
 */
export function resolveIconIn(name: string, set: IconSet): string | null {
  const n = String(name ?? "").trim();
  if (!n) return null;
  if (set === "hugeicons") {
    if (!huge) return HUGE + bareIcon(n);
    const h = hugeiconFor(n);
    if (h) return HUGE + h;
  }
  return normalizeIcon(bareIcon(n));
}

export interface IconDrawing {
  /** SVG path data on a 24×24 grid, drawn with the icon's stroke. */
  stroke: string;
  /** Parts drawn filled, if any. */
  fill?: string;
  evenOdd?: boolean;
}

/** What to draw for a stored icon name: its paths, "pending" while its set loads, or null if it's no icon. */
export function iconDrawing(name: string): IconDrawing | "pending" | null {
  const hit = drawings.get(name);
  if (hit !== undefined) return hit;
  let out: IconDrawing | null = null;
  if (name.startsWith(HUGE)) {
    if (!huge) {
      ensureIconSet("hugeicons").catch(() => {});
      return "pending";
    }
    const key = hugeiconFor(name);
    const e = key ? huge.icons[key] : undefined;
    if (e) out = typeof e === "string" ? { stroke: e } : { stroke: e[0], fill: e[1], evenOdd: e[2] === 1 };
  }
  if (!out) {
    const shape = iconShape(bareIcon(name));
    out = shape ? { stroke: iconToSvgPath(shape) } : null;
  }
  drawings.set(name, out);
  return out;
}

/** Real icons whose names share the most words with an unknown one ("video-editor" → clapperboard, film, video…). */
export function suggestIcons(name: string, max = 3): string[] {
  const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored: [string, number][] = [];
  for (const cand of LUCIDE_NAMES) {
    const parts = cand.split("-");
    let score = 0;
    for (const w of words) {
      if (parts.includes(w)) score += 3;
      else if (parts.some((p) => p.startsWith(w) || w.startsWith(p))) score += 1;
    }
    // Shorter names are the plain versions ("video" over "video-off").
    if (score) scored.push([cand, score - parts.length * 0.1]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n);
}

const MIRRORED = new Set(["send", "send-horizontal", "log-in", "log-out", "undo", "redo", "undo-2", "redo-2", "undo-dot", "redo-dot", "reply", "reply-all", "forward", "list-indent-increase", "list-indent-decrease"]);

/** Icons that imply reading direction and must be mirrored in RTL layouts (arrows, chevrons, send…). */
export function isDirectional(name: string): boolean {
  const n = name.startsWith(HUGE) ? bareIcon(name) : (resolveIcon(name) ?? name);
  return MIRRORED.has(n) || /(^|-)(left|right)(-|$)/.test(n) || /^(sent|logout|login|undo|redo)(-\d{2})?$/.test(n);
}

/** The name to store for an icon: a studio short name as written (it keeps drawing what it drew), else Lucide's canonical name. */
export function normalizeIcon(name: string): string | null {
  const lower = String(name ?? "").trim().toLowerCase();
  return STUDIO_NAMES[lower] ? lower : resolveIcon(name);
}

/** How models should name icons (stable, for cached prompts). */
export const ICON_GUIDE = `Icons: any icon from the Lucide library (lucide.dev/icons, ${LUCIDE_NAMES.length} icons), by its exact kebab-case name, e.g. x, arrow-left, chevron-right, search, bell, house, user, settings, map-pin, calendar, clock, heart, star, share-2, download, upload, trash, pencil, plus, minus, check, circle-check, circle-alert, triangle-alert, info, ellipsis-vertical, shopping-cart, credit-card, wallet, car, utensils, play, pause, scissors, film, image, music, mic, layers. Pick the icon that says exactly what the control does. The studio's short names close, more, help and alert also work.`;

/** A path element starts at the origin, where a leading relative "m" means an absolute move. */
function absoluteStart(d: string): string {
  const head = /^\s*m/.exec(d);
  if (!head) return d;
  const rest = d.slice(head[0].length);
  const num = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  const x = num.exec(rest);
  const y = x && num.exec(rest);
  if (!x || !y) return d;
  // The pairs after the first are relative line-tos: keep them relative with an explicit "l".
  const after = rest.slice(num.lastIndex);
  return `M${x[0]} ${y[0]}${/^[\s,]*[-+.\d]/.test(after) ? `l${after.replace(/^[\s,]+/, "")}` : after}`;
}

/**
 * Convert a lucide icon definition (24×24 viewBox) to a single SVG path string. Each element is
 * made to start with an absolute move, so joining them doesn't shift one by where the last ended
 * (lucide's X is "M18 6 6 18" then "m6 6 12 12").
 */
export function iconToSvgPath(shape: IconShape): string {
  const n = (v: string | number | undefined) => Number(v ?? 0);
  const parts: string[] = [];
  for (const [tag, a] of shape) {
    switch (tag) {
      case "path":
        parts.push(absoluteStart(String(a.d)));
        break;
      case "circle": {
        const cx = n(a.cx), cy = n(a.cy), r = n(a.r);
        parts.push(`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
        break;
      }
      case "ellipse": {
        const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx), ry = n(a.ry);
        parts.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`);
        break;
      }
      case "line":
        parts.push(`M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`);
        break;
      case "polyline":
      case "polygon": {
        const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
        let d = `M${pts[0]} ${pts[1]}`;
        for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
        parts.push(tag === "polygon" ? d + "Z" : d);
        break;
      }
      case "rect": {
        const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
        const r = Math.min(n(a.rx ?? a.ry), w / 2, h / 2);
        parts.push(
          r
            ? `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
            : `M${x} ${y}H${x + w}V${y + h}H${x}Z`,
        );
        break;
      }
    }
  }
  return parts.join(" ");
}
