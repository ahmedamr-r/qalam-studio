// Writes src/connectors/logos.json: each connector's mark as one 24×24 path, with its brand colour
// and name. Most come from Simple Icons (CC0-1.0). Slack (which Simple Icons dropped) and Amplitude
// (which it never had) come from their own media kits, kept in scripts/brand-logos/. Call recordings
// have no one brand and draw lucide's AudioLines instead (src/ui/brand/ConnectorLogo.tsx).
// Simple Icons is 16 MB, so it isn't a dependency: the pinned version is packed into a scratch
// folder and only its data and SVG files are read (none of its code runs). Pass the folder of an
// unpacked copy to skip the download. Run after changing a connector or the version:
//   npx tsx scripts/brand-logos.mts [path/to/simple-icons/package]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG } from "../src/connectors/catalog";

const VERSION = "16.33.0";

/** Connector → Simple Icons slug. */
const SIMPLE: Record<string, string> = {
  notion: "notion",
  drive: "googledrive",
  confluence: "confluence",
  intercom: "intercom",
  zendesk: "zendesk",
  linear: "linear",
  jira: "jira",
  github: "github",
  figma: "figma",
  posthog: "posthog",
  mixpanel: "mixpanel",
};

/** Connector → its media kit's mark, as kept here, and the colour its guidelines give a one-colour mark. */
const OWN: Record<string, { file: string; title: string; hex: string; from: string }> = {
  slack: { file: "slack.svg", title: "Slack", hex: "000000", from: "Slack Media Kit Logos (slack.com/media-kit): SLA-Slack-icon-black-RGB.svg" },
  amplitude: { file: "amplitude.svg", title: "Amplitude", hex: "0052F2", from: "Amplitude brand site (brand.amplitude.com/visual-direction/logo): Amplitude Logo.zip, Mark/Circle/logo_amplitude_mark-circle_black_RGB.svg" },
};

/** No logo of its own (see above). */
const NONE = new Set(["calls"]);

type Logo = { path: string; hex: string; title: string };

function simpleIcons(): { dir: string; done: () => void } {
  const given = process.argv[2];
  if (given) return { dir: given, done: () => {} };
  const tmp = mkdtempSync(join(tmpdir(), "simple-icons-"));
  execFileSync("npm", ["pack", `simple-icons@${VERSION}`, "--pack-destination", tmp, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
  execFileSync("tar", ["-xzf", join(tmp, `simple-icons-${VERSION}.tgz`), "-C", tmp]);
  return { dir: join(tmp, "package"), done: () => rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// A media kit's SVG as one path on Simple Icons' grid: every <path> joined, scaled to fit 24×24 and
// centred. Anything else (a transform, a circle) stops the script, so the file gets looked at.

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Path data as commands with their numbers (arc flags may be packed: "a1 1 0 01.5.5"). */
function parsePath(d: string): [string, number[]][] {
  const out: [string, number[]][] = [];
  let i = 0;
  let cmd = "";
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const num = () => {
    skip();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`Path data: no number at ${i}: ${d.slice(i, i + 20)}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = () => {
    skip();
    const f = d[i++];
    if (f !== "0" && f !== "1") throw new Error(`Path data: arc flag at ${i - 1}`);
    return Number(f);
  };
  for (skip(); i < d.length; skip()) {
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    else if (!cmd || cmd.toLowerCase() === "z") throw new Error(`Path data: number without a command at ${i}`);
    const n = ARGS[cmd.toLowerCase()];
    if (n === undefined) throw new Error(`Path data: unknown command ${cmd}`);
    out.push([cmd, cmd.toLowerCase() === "a" ? [num(), num(), num(), flag(), flag(), num(), num()] : Array.from({ length: n }, num)]);
    // Further pairs after a moveto are linetos.
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
  }
  return out;
}

const fmt = (n: number) => String(Number(n.toFixed(3))).replace(/^(-?)0\./, "$1.");

/** Scale by `k` and move by (dx, dy): absolute coordinates move, relative ones only scale. */
function transformPath(d: string, k: number, dx: number, dy: number): string {
  return parsePath(d)
    .map(([cmd, a], i) => {
      // A path's first moveto is absolute even when written relative.
      const c = i === 0 && cmd === "m" ? "M" : cmd;
      const abs = c === c.toUpperCase();
      const x = (v: number) => v * k + (abs ? dx : 0);
      const y = (v: number) => v * k + (abs ? dy : 0);
      const lc = c.toLowerCase();
      const out =
        lc === "h" ? [x(a[0])]
        : lc === "v" ? [y(a[0])]
        : lc === "a" ? [a[0] * k, a[1] * k, a[2], a[3], a[4], x(a[5]), y(a[6])]
        : a.map((v, j) => (j % 2 ? y(v) : x(v)));
      return c + out.map((v, j) => (lc === "a" && (j === 3 || j === 4) ? String(v) : fmt(v))).join(" ");
    })
    .join("");
}

function ownMark(file: string): string {
  const svg = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const unsupported = /<(circle|ellipse|rect|polygon|polyline|line|use|image|text)\b|\btransform=/.exec(svg);
  if (unsupported) throw new Error(`${file}: ${unsupported[0]} isn't handled; turn it into plain paths first.`);
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4) throw new Error(`${file}: no viewBox`);
  const [x0, y0, w, h] = vb;
  const k = 24 / Math.max(w, h);
  const paths = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!paths.length) throw new Error(`${file}: no paths`);
  return paths.map((d) => transformPath(d, k, -x0 * k + (24 - w * k) / 2, -y0 * k + (24 - h * k) / 2)).join("");
}

// ---------------------------------------------------------------------------

const si = simpleIcons();
const data = JSON.parse(readFileSync(join(si.dir, "data", "simple-icons.json"), "utf8")) as { title: string; slug: string; hex: string }[];
const version = JSON.parse(readFileSync(join(si.dir, "package.json"), "utf8")).version as string;
if (version !== VERSION) console.warn(`Simple Icons ${version}, not the pinned ${VERSION}`);

const logos: Record<string, Logo> = {};
const missing: string[] = [];
for (const c of CATALOG) {
  if (NONE.has(c.id)) continue;
  const slug = SIMPLE[c.id];
  if (slug) {
    const entry = data.find((e) => e.slug === slug);
    const svg = readFileSync(join(si.dir, "icons", `${slug}.svg`), "utf8");
    const path = /<path d="([^"]+)"/.exec(svg)?.[1];
    if (!entry || !path || !svg.includes('viewBox="0 0 24 24"')) throw new Error(`Simple Icons ${version} has no usable "${slug}"`);
    logos[c.id] = { path, hex: entry.hex.toUpperCase(), title: entry.title };
    continue;
  }
  const own = OWN[c.id];
  const file = own && new URL(`./brand-logos/${own.file}`, import.meta.url).pathname;
  if (!own || !existsSync(file)) {
    missing.push(c.id);
    continue;
  }
  logos[c.id] = { path: ownMark(file), hex: own.hex, title: own.title };
}
si.done();

const source = [`Simple Icons ${version} (CC0-1.0)`, ...Object.keys(OWN).filter((id) => logos[id]).map((id) => OWN[id].from)].join("; ");
const out = { source, logos };
writeFileSync(new URL("../src/connectors/logos.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${Object.keys(logos).length} logos${missing.length ? `; none for ${missing.join(", ")} (they show a letter)` : ""}`);
