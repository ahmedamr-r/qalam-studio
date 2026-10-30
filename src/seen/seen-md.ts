import { MOVE_HOWS, SCREEN_KINDS, SEEN_LIMITS, type MoveHow, type ScreenCan, type ScreenKind, type SeenFlow, type SeenMap, type SeenMove, type SeenScreen } from "./types";

/*
 * hub/seen/<key>.md: what people see in a product, readable like a topic page (pure). Its flows
 * first, each screen in order with the control that leads to it, the branches off it and what the
 * screenshots don't show yet; then every screen, its pictures (links into assets/, so any Markdown
 * viewer shows them) and its notes. Each flow, step and screen keeps its record in a comment; the
 * words are a person's to edit (names, what a screen is for, what's on it, its states, a flow's aim
 * and gaps), the records aren't. A screen keeps its key while any of its screenshots does, a flow
 * while its name or most of its steps do (`withSeenKeys`), so what links to them stays.
 */

const RECORD = /\s*<!--\s*qalam\s+(\{.*\})\s*-->\s*$/;
/** A record in a comment: JSON that can't close the comment early. */
const record = (o: unknown) => ` <!-- qalam ${JSON.stringify(o).replace(/--/g, "-\\u002d")} -->`;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const json = (s: string): Record<string, unknown> => {
  try {
    return rec(JSON.parse(s));
  } catch {
    return {};
  }
};
const one = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max) : []);
const kindOf = (v: unknown): ScreenKind => (typeof v === "string" && (SCREEN_KINDS as readonly string[]).includes(v) ? (v as ScreenKind) : "other");
const howOf = (v: unknown): MoveHow => (typeof v === "string" && (MOVE_HOWS as readonly string[]).includes(v) ? (v as MoveHow) : "tap");
const byOf = (v: unknown): "qalam" | "you" => (v === "you" ? "you" : "qalam");
const atOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const quoted = (s: string) => `“${s}”`;

export interface SeenMdNames {
  productName?: string;
  goalTitle: (id: string) => string | undefined;
  /** A picture's path from hub/seen/, when its file is known ("../../assets/<hash>.png"). */
  picture: (ref: string) => string | undefined;
}

function moveWords(m: SeenMove): string {
  if (m.via) return `on ${quoted(m.via)}`;
  return m.how === "back" ? "going back" : m.how === "system" ? "by itself" : m.how === "swipe" ? "with a swipe" : m.how === "type" ? "by typing" : "how isn't shown";
}

export function seenToMarkdown(m: SeenMap, o: SeenMdNames): string {
  const names = new Map(m.screens.map((s) => [s.key, s.name]));
  const shots = m.screens.reduce((n, s) => n + s.shots.length, 0);
  const head = ["---", `qalam: "seen/1"`, `key: ${JSON.stringify(m.key)}`, `product: ${JSON.stringify(m.product)}`, `readAt: ${m.readAt}`, `gone: ${JSON.stringify(m.gone)}`, "---", ""];
  const body = [`# What people see in ${o.productName ?? "the product"} today`, "", `From ${shots} screenshot${shots === 1 ? "" : "s"}, read ${new Date(m.readAt).toISOString().slice(0, 10)}. Each move names the control that makes it, as the screen shows it. Qalam reads them again when you add more: edit the words, not the records.`, ""];
  for (const f of m.flows) {
    const goal = f.goal ? o.goalTitle(f.goal) : undefined;
    body.push(`## ${one(f.name)}${f.aim ? ` · ${one(f.aim)}` : ""}${record({ key: f.key, ...(f.goal ? { goal: f.goal } : {}), by: f.by, at: f.at })}`, "");
    if (goal) body.push(`Serves: ${one(goal)}`, "");
    if (f.entry) body.push(`Starts from: ${one(f.entry)}`, "");
    f.steps.forEach((s, i) => {
      const move = i > 0 ? f.moves.find((x) => x.from === f.steps[i - 1] && x.to === s) : undefined;
      body.push(`${i + 1}. ${one(names.get(s) ?? s)}${move ? `, ${moveWords(move)}` : ""}${record({ screen: s, ...(move?.via ? { via: move.via } : {}), ...(move ? { how: move.how } : {}) })}`);
    });
    const along = new Set(f.steps.slice(1).map((s, i) => `${f.steps[i]}>${s}`));
    const branches = f.moves.filter((x) => !along.has(`${x.from}>${x.to}`));
    if (branches.length) body.push("", ...branches.map((x) => `- From ${one(names.get(x.from) ?? x.from)}, ${moveWords(x)} goes to ${one(names.get(x.to) ?? x.to)}${record({ from: x.from, to: x.to, ...(x.via ? { via: x.via } : {}), how: x.how })}`));
    if (f.notShown.length) body.push("", "Not shown yet:", ...f.notShown.map((n) => `- ${one(n)}`));
    if (f.note) body.push("", `Note: ${one(f.note)}`);
    body.push("");
  }
  body.push(`## Screens${record({ screens: true })}`, "");
  for (const s of m.screens) {
    body.push(`### ${one(s.name)} · ${s.kind}${record({ key: s.key, kind: s.kind, shots: s.shots, can: s.can, nav: s.nav, ...(s.step ? { step: s.step } : {}), by: s.by, at: s.at })}`, "");
    const main = s.shots[0] && o.picture(s.shots[0]);
    if (main) body.push(`![${one(s.name)}](${main})`, "");
    if (s.does) body.push(`What it's for: ${one(s.does)}`);
    if (s.on) body.push(`On it: ${one(s.on)}`);
    if (s.can.length) body.push(`You can: ${s.can.map((c) => `${quoted(c.label)}${c.does ? ` (${one(c.does)})` : ""}`).join(", ")}`);
    if (s.nav.length) body.push(`Navigation: ${s.nav.map(quoted).join(", ")}`);
    if (s.design) body.push(`Design: ${one(s.design)}`);
    for (const shot of s.shots.slice(1)) {
      const pic = o.picture(shot);
      body.push(`State: ${pic ? `![${one(s.name)}, another state](${pic}) ` : ""}${one(s.states[shot] ?? "")}${record({ shot })}`);
    }
    body.push("");
  }
  return [...head, ...body].join("\n");
}

const FIELD: Record<string, "does" | "on" | "design"> = { "What it's for": "does", "On it": "on", Design: "design" };

/** A map file read back: its records, with the words people edited. Null when it isn't one. */
export function seenFromMarkdown(md: string): SeenMap | null {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!fm || !/qalam:\s*"seen\/1"/.test(fm[1])) return null;
  const field = (k: string) => {
    const m = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm[1]);
    if (!m) return undefined;
    try {
      return JSON.parse(m[1]) as unknown;
    } catch {
      return undefined;
    }
  };
  const key = field("key");
  const readAt = field("readAt");
  if (typeof key !== "string" || typeof readAt !== "number") return null;
  const product = field("product");

  const flows: SeenFlow[] = [];
  const screens: SeenScreen[] = [];
  type Step = { screen: string; via?: string; how?: MoveHow };
  const steps = new Map<SeenFlow, Step[]>();
  let flow: SeenFlow | null = null;
  let screen: SeenScreen | null = null;
  let mode: "flow" | "gaps" | "screens" | null = null;
  for (const raw of md.slice(fm[0].length).split("\n")) {
    const r = RECORD.exec(raw);
    const data = r ? json(r[1]) : {};
    const line = raw.replace(RECORD, "");
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      flow = null;
      screen = null;
      if (data.screens === true) {
        mode = "screens";
        continue;
      }
      if (typeof data.key !== "string") {
        mode = null;
        continue;
      }
      const [name, ...aim] = h2[1].split(" · ");
      flow = { key: data.key, name: one(name), aim: one(aim.join(" · ")), ...(typeof data.goal === "string" ? { goal: data.goal } : {}), steps: [], moves: [], notShown: [], by: byOf(data.by), at: atOf(data.at) };
      flows.push(flow);
      steps.set(flow, []);
      mode = "flow";
      continue;
    }
    if (mode === "screens") {
      const h3 = /^###\s+(.+)$/.exec(line);
      if (h3) {
        screen = null;
        if (typeof data.key !== "string") continue;
        const name = one(h3[1].replace(/\s·\s[a-z-]+\s*$/, ""));
        const can: ScreenCan[] = (Array.isArray(data.can) ? data.can : [])
          .map(rec)
          .filter((c) => typeof c.label === "string" && c.label.trim())
          .slice(0, SEEN_LIMITS.can)
          .map((c) => ({ label: String(c.label), ...(typeof c.does === "string" && c.does.trim() ? { does: c.does } : {}) }));
        screen = { key: data.key, name, shots: strs(data.shots, 20), states: {}, kind: kindOf(data.kind), can, nav: strs(data.nav, SEEN_LIMITS.nav), ...(typeof data.step === "string" ? { step: data.step } : {}), by: byOf(data.by), at: atOf(data.at) };
        if (screen.shots.length) screens.push(screen);
        else screen = null;
        continue;
      }
      if (!screen) continue;
      const f = /^(What it's for|On it|Design):\s*(.*)$/.exec(line);
      if (f) {
        const text = one(f[2]);
        if (text) screen[FIELD[f[1]]] = text;
        continue;
      }
      const st = /^State:\s*(?:!\[[^\]]*\]\([^)]*\)\s*)?(.*)$/.exec(line);
      if (st && typeof data.shot === "string" && screen.shots.includes(data.shot)) {
        const text = one(st[1]);
        if (text) screen.states[data.shot] = text;
      }
      continue;
    }
    if (!flow) continue;
    if (/^Not shown yet:\s*$/.test(line)) {
      mode = "gaps";
      continue;
    }
    const start = /^Starts from:\s*(.+)$/.exec(line);
    if (start) {
      flow.entry = one(start[1]);
      continue;
    }
    const note = /^Note:\s*(.+)$/.exec(line);
    if (note) {
      flow.note = one(note[1]);
      continue;
    }
    if (/^\d+\.\s/.test(line) && typeof data.screen === "string") {
      steps.get(flow)!.push({ screen: data.screen, ...(typeof data.via === "string" ? { via: data.via } : {}), ...(data.how !== undefined ? { how: howOf(data.how) } : {}) });
      continue;
    }
    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet && typeof data.from === "string" && typeof data.to === "string") {
      flow.moves.push({ from: data.from, to: data.to, ...(typeof data.via === "string" ? { via: data.via } : {}), how: howOf(data.how) });
      continue;
    }
    if (bullet && mode === "gaps" && !r) flow.notShown.push(one(bullet[1]));
  }

  // Steps and moves name screens that are in the file; a flow keeps two steps or more.
  const known = new Set(screens.map((s) => s.key));
  const kept: SeenFlow[] = [];
  for (const f of flows) {
    const list = steps.get(f)!.filter((s) => known.has(s.screen));
    const along: SeenMove[] = list.slice(1).flatMap((s, i) => (s.how ? [{ from: list[i].screen, to: s.screen, ...(s.via ? { via: s.via } : {}), how: s.how }] : []));
    const branches = f.moves.filter((x) => known.has(x.from) && known.has(x.to));
    if (list.length < 2) continue;
    kept.push({ ...f, steps: list.map((s) => s.screen), moves: [...along, ...branches], notShown: f.notShown.slice(0, SEEN_LIMITS.notShown) });
  }
  return { key, product: typeof product === "string" ? product : null, readAt, screens, flows: kept, gone: strs(field("gone"), 1000) };
}

// ---------------------------------------------------------------------------
// Keys that stay

export const SEEN_SLUG = /^[a-z0-9-]{1,60}$/;

export const seenSlug = (s: string, fallback: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "") || fallback;

/** A key not taken: the slug, else the slug with a number after it. */
function fresh(base: string, taken: Set<string>): string {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

type Unkeyed<T> = Omit<T, "key"> & { key?: string };

/**
 * Each screen's key: the one a screen of the map before had when they share a screenshot; else a new
 * one from its name, never one the map had before. Then each flow's: the one a flow before had with
 * the same name, or with most of the same steps; else a new one. Flows' steps and moves name screens
 * by the keys they had in `screens` (stand-ins too), which this maps to the keys kept.
 */
export function withSeenKeys(screens: Unkeyed<SeenScreen>[], flows: Unkeyed<SeenFlow>[], before?: Pick<SeenMap, "screens" | "flows">): { screens: SeenScreen[]; flows: SeenFlow[]; renamed: Map<string, string> } {
  const old = before?.screens ?? [];
  const taken = new Set(old.map((s) => s.key));
  const used = new Set<string>();
  const renamed = new Map<string, string>();
  const keyed = screens.map((s) => {
    // A key of its own (a screen kept before); a new one's is a stand-in ("~n1") until here.
    const own = s.key && SEEN_SLUG.test(s.key) && !used.has(s.key) ? s.key : undefined;
    const match = own ?? old.find((o) => !used.has(o.key) && o.shots.some((x) => s.shots.includes(x)))?.key;
    const key = match ?? fresh(seenSlug(s.name, "screen"), new Set([...taken, ...used]));
    used.add(key);
    if (s.key) renamed.set(s.key, key);
    return { ...s, key } as SeenScreen;
  });
  const map = (k: string) => renamed.get(k) ?? k;
  const oldFlows = before?.flows ?? [];
  const takenFlows = new Set(oldFlows.map((f) => f.key));
  const usedFlows = new Set<string>();
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const keyedFlows = flows.map((f) => {
    const steps = f.steps.map(map);
    const moves = f.moves.map((m) => ({ ...m, from: map(m.from), to: map(m.to) }));
    const share = (o: SeenFlow) => o.steps.filter((s) => steps.includes(s)).length * 2 >= Math.max(o.steps.length, steps.length);
    const own = f.key && SEEN_SLUG.test(f.key) && !usedFlows.has(f.key) ? f.key : undefined;
    const match = own ?? oldFlows.find((o) => !usedFlows.has(o.key) && same(o.name, f.name))?.key ?? oldFlows.find((o) => !usedFlows.has(o.key) && share(o))?.key;
    const key = match ?? fresh(seenSlug(f.name, "flow"), new Set([...takenFlows, ...usedFlows]));
    usedFlows.add(key);
    return { ...f, key, steps, moves } as SeenFlow;
  });
  return { screens: keyed, flows: keyedFlows, renamed };
}
