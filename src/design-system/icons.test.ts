import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ICON_NAMES,
  iconDrawing,
  iconNamesFor,
  iconSetReady,
  iconShape,
  iconToSvgPath,
  isDirectional,
  normalizeIcon,
  onIconSetLoaded,
  resolveIcon,
  resolveIconIn,
  setHugeicons,
  suggestIcons,
  type HugeiconsData,
} from "./icons";
import { buildInstance } from "./builders";
import { TokenSet } from "./resolve";
import BUILTIN_TREE from "./tokens.json";

/** Every point a path moves or draws to (curve end points included), following relative commands. */
function endpoints(d: string): [number, number][] {
  const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const out: [number, number][] = [];
  let at = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = "";
  const skip = () => {
    while (at < d.length && /[\s,]/.test(d[at])) at++;
  };
  const num = () => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(d.slice(at))!;
    at += m[0].length;
    return Number(m[0]);
  };
  // Arc flags are single digits and may be written without separators ("a2 2 0 00-2-2").
  const flag = () => {
    skip();
    return Number(d[at++]);
  };
  for (;;) {
    skip();
    if (at >= d.length) break;
    if (/[a-zA-Z]/.test(d[at])) cmd = d[at++];
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (lower === "z") {
      [x, y] = [sx, sy];
      continue;
    }
    const a = lower === "a" ? [num(), num(), num(), flag(), flag(), num(), num()] : Array.from({ length: ARGS[lower] }, num);
    if (lower === "h") x = rel ? x + a[0] : a[0];
    else if (lower === "v") y = rel ? y + a[0] : a[0];
    else {
      const [ex, ey] = a.slice(-2);
      [x, y] = rel ? [x + ex, y + ey] : [ex, ey];
    }
    if (lower === "m") {
      [sx, sy] = [x, y];
      // Pairs after a move are line-tos of the same kind.
      cmd = rel ? "l" : "L";
    }
    out.push([x, y]);
  }
  return out;
}

describe("icons", () => {
  it("draws every Lucide icon inside its 24×24 box once its paths are joined", () => {
    const outside = ICON_NAMES.filter((n) => endpoints(iconToSvgPath(iconShape(n)!)).some(([x, y]) => x < -1 || y < -1 || x > 25 || y > 25));
    expect(outside).toEqual([]);
  });

  it("keeps each path's relative start where the icon means it (the close icon's second stroke)", () => {
    expect(iconToSvgPath(iconShape("x")!)).toBe("M18 6 6 18 M6 6l12 12");
    expect(iconToSvgPath(iconShape("arrow-left")!)).toBe("M12 19l-7-7 7-7 M19 12H5");
  });

  it("covers the whole installed library", () => {
    const dir = join(dirname(createRequire(import.meta.url).resolve("lucide")), "..", "esm", "icons");
    const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).sort();
    // If this fails after a lucide upgrade: node scripts/lucide-names.mjs
    expect(ICON_NAMES).toEqual(files);
    expect(ICON_NAMES.every((n) => iconShape(n) && resolveIcon(n) === n)).toBe(true);
  });

  it("resolves the ways people and models write icon names", () => {
    expect(resolveIcon("x")).toBe("x");
    expect(resolveIcon("close")).toBe("x");
    expect(resolveIcon("home")).toBe("house");
    expect(resolveIcon("alert-triangle")).toBe("triangle-alert");
    expect(resolveIcon("AlertTriangle")).toBe("triangle-alert");
    expect(resolveIcon("ArrowLeft")).toBe("arrow-left");
    expect(resolveIcon("LuArrowLeft")).toBe("arrow-left");
    expect(resolveIcon("lucide:map-pin")).toBe("map-pin");
    expect(resolveIcon("arrow_left")).toBe("arrow-left");
    expect(resolveIcon("settings-outline")).toBe("settings");
    expect(resolveIcon("gear")).toBe("settings");
    expect(resolveIcon("more-vertical")).toBe("ellipsis-vertical");
    expect(resolveIcon("video-editor")).toBeNull();
    expect(suggestIcons("video-editor")).toContain("video");
  });

  it("stores studio short names as written and everything else by Lucide's canonical name", () => {
    expect(normalizeIcon("close")).toBe("close");
    expect(normalizeIcon("AlertTriangle")).toBe("triangle-alert");
    expect(normalizeIcon("nope-nope")).toBeNull();
    // Lucide's own names mean Lucide's icon; studio short names only fill names Lucide doesn't have.
    expect(resolveIcon("share")).toBe("share");
    expect(resolveIcon("sliders")).toBe("sliders-horizontal");
  });

  it("mirrors icons that point along the reading direction", () => {
    for (const n of ["arrow-left", "chevron-right", "chevrons-left", "arrow-big-right", "send", "undo", "log-out", "back"]) expect(isDirectional(n), n).toBe(true);
    for (const n of ["x", "close", "search", "arrow-up", "play"]) expect(isDirectional(n), n).toBe(false);
  });

  it("uses any Lucide icon in components, and suggests real ones for a name that isn't", () => {
    const ok = buildInstance({ component: "IconButton", props: { icon: "clapperboard", label: "Clips" } }, { dir: "ltr", lang: "en" });
    expect(ok.flags ?? []).toEqual([]);
    const bad = buildInstance({ component: "IconButton", props: { icon: "video-editor", label: "Edit" } }, { dir: "ltr", lang: "en" });
    const flag = bad.children![0].flags![0];
    expect(flag.rule).toBe("unknown-icon");
    expect(flag.message).toMatch(/closest: .*video/);
    expect(bad.children![0].icon!.name).toBe("help");
  });
});

describe("Hugeicons", () => {
  const data = () => JSON.parse(readFileSync(join(process.cwd(), "public/icons/hugeicons.json"), "utf8")) as HugeiconsData;

  it("keeps names with their set while Hugeicons loads, and draws them once it's there", () => {
    expect(iconSetReady("hugeicons")).toBe(false);
    expect(resolveIconIn("close", "hugeicons")).toBe("hugeicons:close");
    expect(iconDrawing("hugeicons:close")).toBe("pending");
    const loaded: string[] = [];
    const off = onIconSetLoaded(() => loaded.push("hugeicons"));
    setHugeicons(data());
    off();
    expect(loaded).toEqual(["hugeicons"]);
    expect(iconSetReady("hugeicons")).toBe(true);
    const d = iconDrawing("hugeicons:close");
    expect(d !== "pending" && d?.stroke).toBe(iconDrawing("hugeicons:x") !== "pending" && (iconDrawing("hugeicons:x") as { stroke: string }).stroke);
  });

  it("gives the names models write their Hugeicons counterparts", () => {
    expect(resolveIconIn("x", "hugeicons")).toBe("hugeicons:x");
    expect(resolveIconIn("close", "hugeicons")).toBe("hugeicons:x");
    expect(resolveIconIn("more", "hugeicons")).toBe(resolveIconIn("ellipsis-vertical", "hugeicons"));
    expect(resolveIconIn("house", "hugeicons")).toBe("hugeicons:home-01");
    expect(resolveIconIn("search", "hugeicons")).toBe("hugeicons:search-01");
    expect(resolveIconIn("settings", "hugeicons")).toBe("hugeicons:settings-01");
    expect(resolveIconIn("share-2", "hugeicons")).toBe("hugeicons:share-02");
    expect(resolveIconIn("hugeicons:cancel-01", "hugeicons")).toBe("hugeicons:cancel-01");
    // Lucide names cover most of Hugeicons; the rest keep their Lucide icon.
    const covered = ICON_NAMES.filter((n) => resolveIconIn(n, "hugeicons")?.startsWith("hugeicons:")).length;
    expect(covered / ICON_NAMES.length).toBeGreaterThan(0.85);
    const lucideOnly = ICON_NAMES.find((n) => !resolveIconIn(n, "hugeicons")!.startsWith("hugeicons:"))!;
    expect(resolveIconIn(lucideOnly, "hugeicons")).toBe(lucideOnly);
    // Back in a Lucide system, a Hugeicons name still means something.
    expect(resolveIconIn("hugeicons:home-01", "lucide")).toBe("house");
    expect(resolveIconIn("hugeicons:cancel-01", "lucide")).toBe("x");
  });

  it("draws every Hugeicons icon inside its 24×24 box, fills included", () => {
    const outside = iconNamesFor("hugeicons").filter((n) => {
      const d = iconDrawing(`hugeicons:${n}`);
      if (!d || d === "pending") return true;
      return [d.stroke, d.fill ?? ""].some((p) => endpoints(p).some(([x, y]) => x < -1 || y < -1 || x > 25 || y > 25));
    });
    expect(outside).toEqual([]);
    const filled = iconNamesFor("hugeicons").filter((n) => (iconDrawing(`hugeicons:${n}`) as { fill?: string }).fill);
    expect(filled.length).toBeGreaterThan(50);
  });

  it("builds a system's icons from its set, at the set's stroke weight", () => {
    const tree = structuredClone(BUILTIN_TREE) as Record<string, unknown>;
    tree.$extensions = { "qalam.iconSet": "hugeicons" };
    const ts = new TokenSet(tree);
    expect(ts.iconSet).toBe("hugeicons");
    const box = buildInstance({ component: "IconButton", props: { icon: "close", label: "Close" } }, { dir: "ltr", lang: "en", ts });
    expect(box.children![0].icon).toMatchObject({ name: "hugeicons:x", strokeWidth: 1.5 });
    const lucide = buildInstance({ component: "IconButton", props: { icon: "close", label: "Close" } }, { dir: "ltr", lang: "en" });
    expect(lucide.children![0].icon).toMatchObject({ name: "close", strokeWidth: 2 });
  });
});
