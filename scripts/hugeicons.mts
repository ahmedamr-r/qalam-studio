// Writes public/icons/hugeicons.json from @hugeicons/core-free-icons (MIT): every free icon as
// ready-to-draw SVG path data, plus the package's aliases. The studio fetches it only when a design
// system uses Hugeicons. Run after upgrading the package:
//   npx tsx scripts/hugeicons.mts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { iconToSvgPath, type IconShape } from "../src/design-system/icons";

type Attrs = Record<string, string | number>;

const require = createRequire(import.meta.url);
const esm = join(dirname(require.resolve("@hugeicons/core-free-icons")), "..", "esm");
const version = JSON.parse(readFileSync(join(esm, "..", "..", "package.json"), "utf8")).version as string;

/** "Cancel01Icon" → "cancel-01", "ArrowLeft01FreeIcons" → "arrow-left-01". */
const kebab = (s: string) =>
  s
    .replace(/(FreeIcons|Icon)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();

/** matrix(a b c d e f) or rotate(deg cx cy), as a matrix. */
function matrixOf(t: string): number[] | null {
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (m) return m[1].trim().split(/[\s,]+/).map(Number);
  const r = /rotate\(([^)]+)\)/.exec(t);
  if (!r) return null;
  const [deg, cx = 0, cy = 0] = r[1].trim().split(/[\s,]+/).map(Number);
  const a = (deg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

/** Bake a transform into a circle, ellipse or rect (the only elements Hugeicons transforms). */
function baked(tag: string, a: Attrs): [string, Attrs] {
  const m = typeof a.transform === "string" ? matrixOf(a.transform) : null;
  if (!m) return [tag, a];
  const [ma, mb, mc, md, me, mf] = m;
  const at = (x: number, y: number) => [ma * x + mc * y + me, mb * x + md * y + mf];
  if (tag === "circle" || tag === "ellipse") {
    const [cx, cy] = at(Number(a.cx ?? 0), Number(a.cy ?? 0));
    const quarter = Math.abs(ma) < 0.5;
    return [tag, { ...a, cx, cy, ...(tag === "ellipse" && quarter ? { rx: a.ry, ry: a.rx } : {}) }];
  }
  if (tag === "rect") {
    const [x, y, w, h] = [a.x, a.y, a.width, a.height].map((v) => Number(v ?? 0));
    const pts = [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)].flat();
    return ["polygon", { points: pts.join(" ") }];
  }
  return [tag, a];
}

/** Round coordinates to 0.01 (a 24px grid doesn't need more) and drop leading zeros. Arc flags have no decimals, so they're untouched. */
const compact = (d: string) => d.replace(/-?\d*\.\d{3,}/g, (n) => String(Number(Number(n).toFixed(2))).replace(/^(-?)0\./, "$1."));

const all = (await import(pathToFileURL(join(esm, "index.js")).href)) as Record<string, unknown>;
const icons: Record<string, string | [string, string] | [string, string, 1]> = {};
const aliases: Record<string, string> = {};
// The index re-exports each icon file under its names: the file is the canonical one.
for (const line of readFileSync(join(esm, "index.js"), "utf8").split("\n")) {
  const m = /^export \{ (.+) \} from '\.\/(\w+)\.js';/.exec(line);
  if (!m) continue;
  const name = kebab(m[2]);
  const shape = all[m[2]] as [string, Attrs][] | undefined;
  if (!shape) continue;
  const stroke: [string, Attrs][] = [];
  const fill: [string, Attrs][] = [];
  let evenOdd = false;
  for (const [tag, attrs] of shape) {
    const el = baked(tag, attrs);
    if (attrs.stroke && attrs.stroke !== "none") stroke.push(el);
    if (attrs.fill && attrs.fill !== "none") {
      fill.push(el);
      if (attrs.fillRule === "evenodd") evenOdd = true;
    }
  }
  const s = compact(iconToSvgPath(stroke as IconShape));
  icons[name] = fill.length ? (evenOdd ? [s, compact(iconToSvgPath(fill as IconShape)), 1] : [s, compact(iconToSvgPath(fill as IconShape))]) : s;
  for (const alias of m[1].split(", ").map((x) => x.replace(/^default as /, ""))) {
    const k = kebab(alias);
    if (k !== name && !(k in aliases)) aliases[k] = name;
  }
}
// A canonical name always means its own icon.
for (const k of Object.keys(aliases)) if (k in icons) delete aliases[k];

mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });
const out = JSON.stringify({ set: "hugeicons", version, license: "MIT, © Hugeicons (hugeicons.com)", strokeWidth: 1.5, icons, aliases });
writeFileSync(new URL("../public/icons/hugeicons.json", import.meta.url), out);
console.log(`${Object.keys(icons).length} Hugeicons, ${Object.keys(aliases).length} aliases, ${(out.length / 1024).toFixed(0)} KB`);
