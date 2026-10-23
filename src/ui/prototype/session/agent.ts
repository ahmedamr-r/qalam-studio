import type { ScreenSpec } from "@/design-system/builders";
import { tokenSetFor, dsIdForNode } from "@/design-system/registry";
import { aiStatus, callAI } from "@/ai/client";
import type { PartsInput, PartsResult, ProposeInput, ProposeResult, ProposedAsk } from "@/ai/prototype";
import { blockIssues, type Block } from "@/proto/agent/blocks";
import { layerIndex, type LayerEntry } from "@/proto/agent/layers";
import { insertNodes } from "@/doc/ops";
import type { Doc, SceneNode } from "@/doc/schema";
import { studio } from "@/doc/store";
import { candidates, type Candidate } from "@/proto/agent/candidates";
import { buildSteps, type Built } from "@/proto/agent/build";
import { describeScreen } from "@/proto/agent/describe";
import { withoutAsks } from "@/proto/asks";
import { editRoutes, withRoute } from "@/proto/edit";
import { itemRecord } from "@/proto/items";
import { findMoney } from "@/proto/money";
import { RECIPE_NAMES } from "@/proto/recipes";
import { scanFrame } from "@/proto/scan";

/*
 * The prototyping agent, in the session: what it proposes for a screen — code's candidates,
 * picked, ordered and worded by Qalam AI (by code when AI is off) — and building what the
 * designer picked: the parts it needs written by Qalam AI (else by code), each step checked and
 * kept or left out, then committed to the document as one undo step.
 */

export interface ProposalStep {
  candidate: Candidate;
  label: string;
  /** Why it's worth it, and what its new part will hold (the model's). */
  why: string;
  plan: string;
  ticked: boolean;
  /** Proposed by Qalam AI (or, with AI off, by code); else offered as well. */
  proposed: boolean;
}

/** What was asked that isn't built, and why. */
export type AskNote = Pick<ProposedAsk, "label" | "rung" | "reason">;

export interface Proposal {
  steps: ProposalStep[];
  asks: AskNote[];
  by: "model" | "code";
  model?: string;
}

/** A candidate in code's words. */
export const codeLabel = (c: Candidate) => `${RECIPE_NAMES[c.recipe] ?? c.recipe}: ${c.what}`;

/**
 * Leads before followers (a bar after the + that fills it), and alternatives exclusive: ticking
 * one leaves the other out; a ticked follower ticks its lead.
 */
export function settle(steps: ProposalStep[], changed?: string): ProposalStep[] {
  const out = steps.map((s) => ({ ...s }));
  const by = new Map(out.map((s) => [s.candidate.id, s]));
  for (const s of out) {
    const alt = s.candidate.instead ? by.get(s.candidate.instead) : undefined;
    // The one just ticked wins; else the first ticked.
    if (alt && s.ticked && alt.ticked) (changed === alt.candidate.id ? s : alt).ticked = false;
  }
  // Unticked: what follows it goes too, down the chain (the + → its bar → the page the bar opens).
  const untick = (id: string) => {
    for (const s of out)
      if (s.candidate.after === id && s.ticked) {
        s.ticked = false;
        untick(s.candidate.id);
      }
  };
  const was = changed ? by.get(changed) : undefined;
  if (was && !was.ticked) untick(was.candidate.id);
  // Ticked: what it follows comes with it, up the chain.
  for (const s of out) {
    if (!s.ticked) continue;
    for (let lead = s.candidate.after ? by.get(s.candidate.after) : undefined; lead && !lead.ticked; lead = lead.candidate.after ? by.get(lead.candidate.after) : undefined) lead.ticked = true;
  }
  const placed: ProposalStep[] = [];
  const place = (s: ProposalStep) => {
    if (placed.includes(s)) return;
    const lead = s.candidate.after ? by.get(s.candidate.after) : undefined;
    if (lead && !placed.includes(lead)) place(lead);
    placed.push(s);
  };
  out.forEach(place);
  return placed;
}

/** What code proposes on its own: every candidate, the recommended ones ticked. */
export function codeProposal(cs: Candidate[]): Proposal {
  return { steps: settle(cs.map((c) => ({ candidate: c, label: codeLabel(c), why: "", plan: "", ticked: c.recommended, proposed: c.recommended }))), asks: [], by: "code" };
}

/** An ask built from blocks, checked against the layers: a step to tick, or why it can't be built. */
function askStep(a: ProposedAsk, n: number, layers: Map<string, LayerEntry>): ProposalStep | string {
  const blocks: Block[] = (a.blocks ?? []).slice(0, 3).map((b) => ({
    kind: b.kind,
    on: b.on,
    ...(b.target ? { target: b.target } : {}),
    ...(b.look?.length ? { look: b.look.filter((x) => x.prop?.trim()).slice(0, 4) } : {}),
    ...(b.start ? { start: b.start } : {}),
    ...(b.text?.trim() ? { text: b.text.trim().slice(0, 120) } : {}),
    ...(b.part ? { part: b.part } : {}),
  }));
  if (!blocks.length) return "Qalam AI didn't say how.";
  const wrong = blocks.flatMap((b) => blockIssues(b, layers));
  if (wrong.length) return wrong[0];
  const parts = blocks.filter((b) => b.kind === "open-part" || b.kind === "toast");
  if (parts.length > 1) return "It opens more than one part; ask for one at a time.";
  const p = parts[0];
  const at = layers.get(blocks[0].on)!.ref;
  const candidate: Candidate = {
    id: `f${n}`,
    recipe: "blocks",
    what: a.label.trim().slice(0, 120),
    at,
    main: false,
    recommended: true,
    blocks,
    ...(p ? { needs: p.kind === "toast" ? { kind: "toast" as const, role: "done" as const } : { kind: p.part!, role: "custom" as const } } : {}),
  };
  return { candidate, label: candidate.what, why: a.reason?.trim().slice(0, 160) ?? "", plan: p?.kind === "open-part" ? (p.text ?? "") : "", ticked: true, proposed: true };
}

/** The model's proposal, checked: unknown ids out, each candidate once, every candidate offered (what it left out, unticked); asks built from blocks become steps. */
export function fromModel(cs: Candidate[], data: ProposeResult, model?: string, layers: LayerEntry[] = []): Proposal {
  const by = new Map(cs.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const steps: ProposalStep[] = [];
  for (const s of data.steps ?? []) {
    const c = by.get(s.candidate);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    // A page not designed yet is named, and said what it shows, by the model.
    const page = c.recipe === "nextPage" && s.page?.trim() ? { ...c, opts: { ...c.opts, name: s.page.trim().slice(0, 40), brief: s.plan?.trim().slice(0, 300) ?? "" } } : c;
    steps.push({ candidate: page, label: s.label?.trim().slice(0, 120) || codeLabel(c), why: s.why?.trim().slice(0, 160) ?? "", plan: s.plan?.trim().slice(0, 300) ?? "", ticked: !!s.recommended, proposed: true });
  }
  for (const c of cs) if (!seen.has(c.id)) steps.push({ candidate: c, label: codeLabel(c), why: "", plan: "", ticked: false, proposed: false });
  const byLayer = new Map(layers.map((l) => [l.id, l]));
  const asks: AskNote[] = [];
  let n = 0;
  for (const a of (data.asks ?? []).filter((x) => x?.label?.trim()).slice(0, 4)) {
    const note = { label: a.label.trim().slice(0, 120), rung: a.rung === "free-form" ? ("free-form" as const) : ("not-yet" as const), reason: a.reason?.trim().slice(0, 200) ?? "" };
    if (note.rung !== "free-form") {
      asks.push(note);
      continue;
    }
    // Built from blocks: a step to tick; else why it can't be.
    const step = askStep(a, ++n, byLayer);
    if (typeof step === "string") asks.push({ ...note, rung: "not-yet", reason: step });
    else steps.push(step);
  }
  return { steps: settle(steps), asks, by: "model", ...(model ? { model } : {}) };
}

/** Each line asked, as not built, and why. */
const unanswered = (ask: string, reason: string): AskNote[] =>
  ask
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((label) => ({ label: label.slice(0, 120), rung: "not-yet" as const, reason }));

/** What Qalam AI (or code) proposes for the screen. */
export async function propose(doc: Doc, screen: string, ask: string, signal: AbortSignal, onProgress?: (tokens: number) => void): Promise<Proposal> {
  const cs = candidates(doc, screen);
  if (!cs.length && !ask.trim()) return { steps: [], asks: [], by: "code" };
  const { ai } = await aiStatus();
  // Without Qalam AI, what code builds by itself; what was asked waits for it.
  if (!ai) return { ...codeProposal(cs), asks: unanswered(ask, "Qalam AI isn't on here, so only what code builds by itself is listed.") };
  // With an ask, the layers it may point at (and their components' props).
  const layers = ask.trim() ? layerIndex(doc, screen) : [];
  const body: ProposeInput = {
    stage: "propose",
    screen: describeScreen(doc, screen),
    candidates: cs.map((c) => ({ id: c.id, recipe: c.recipe, name: RECIPE_NAMES[c.recipe] ?? c.recipe, what: c.what, main: c.main, ...(c.needs ? { needs: c.needs } : {}), ...(c.after ? { after: c.after } : {}), ...(c.instead ? { instead: c.instead } : {}) })),
    ...(ask.trim() ? { ask: ask.trim(), layers: layers.map((l) => ({ id: l.id, what: l.what })), components: [...new Set(layers.map((l) => l.component))] } : {}),
  };
  const { data, model } = await callAI<ProposeResult>("/api/prototype", body, onProgress, signal);
  return fromModel(cs, data, model, layers);
}

/** What a part is about, for the model: the first item and its price, the action's own words. */
function about(doc: Doc, screen: string, c: Candidate): string {
  const scan = scanFrame(doc, screen);
  const col = scan.collections[0];
  const first = col ? itemAt(doc, screen, col.items[0]) : null;
  const money = scan.texts.map((t) => findMoney(t.text)?.text).find(Boolean) ?? scan.actions.map((a) => findMoney(a.label)?.text).find(Boolean) ?? "";
  switch (c.needs?.role) {
    case "options":
    case "collection":
      return first ? `The first item: "${first.title}"${first.caption ? `, "${first.caption}"` : ""}${first.price ? `, priced "${first.price}" on the screen (write money exactly like that: its currency, digits and separators)` : ""}.` : "";
    case "confirm":
    case "done": {
      const act = scan.actions.find((a) => a.path === c.opts?.action);
      return act ? `The action: "${act.label}" (${act.variant}).${money ? ` Money on the screen is written like "${money}".` : ""}` : "";
    }
    case "custom": {
      // What the designer asked a part to hold, and what opens it.
      const b = c.blocks?.find((x) => x.kind === "open-part");
      const on = b ? layerIndex(doc, screen).find((l) => l.id === b.on) : undefined;
      return `${b?.text ? `It holds: ${b.text}.` : ""}${on ? ` Tapping ${on.what} opens it.` : ""}${money ? ` Money on the screen is written like "${money}".` : ""}`;
    }
    default:
      return "";
  }
}

function itemAt(doc: Doc, screen: string, path: string): { title: string; caption: string; price: string } | null {
  const stack = [...(doc.nodes[screen]?.children ?? [])];
  while (stack.length) {
    const id = stack.shift()!;
    const n = doc.nodes[id];
    if (!n) continue;
    if (n.meta.specPath === path) {
      const r = itemRecord(doc, id, path, 0);
      const texts: string[] = [];
      const walk = (x: string) => {
        const m = doc.nodes[x];
        if (m?.type === "text") texts.push(m.text.content);
        m?.children.forEach(walk);
      };
      walk(id);
      return { title: r.title, caption: r.caption, price: texts.map((t) => findMoney(t)?.text).find(Boolean) ?? "" };
    }
    stack.unshift(...n.children);
  }
  return null;
}

/** A part the model wrote, as a spec for the screen's platform and language (only the shape is taken on trust). */
function asSpec(doc: Doc, screen: string, p: PartsResult["parts"][number], kind: string): ScreenSpec | null {
  const spec = doc.nodes[screen]?.meta.spec as ScreenSpec | undefined;
  const list = (x: unknown) => (Array.isArray(x) ? (x as ScreenSpec["body"]) : []);
  if (!list(p.body).length && !list(p.footer).length && !list(p.header).length) return null;
  return { name: String(p.name ?? "").slice(0, 40) || kind, platform: spec?.platform, dir: spec?.dir, lang: spec?.lang, surface: kind as ScreenSpec["surface"], header: list(p.header), body: list(p.body), footer: list(p.footer) };
}

export interface BuildReport {
  results: Built[];
  /** Whose words the parts have. */
  by: "model" | "code";
  model?: string;
}

/**
 * Builds the ticked steps: Qalam AI writes the parts they need (code does when AI is off or what
 * it writes doesn't pass), each step is checked, and what passes is committed as one undo step.
 */
export async function build(screen: string, proposal: Proposal, signal: AbortSignal, onProgress?: (tokens: number) => void): Promise<BuildReport> {
  const doc = studio().doc;
  const picked = proposal.steps.filter((s) => s.ticked);
  const needing = picked.filter((s) => s.candidate.needs && !s.candidate.part);
  const written = new Map<string, ScreenSpec>();
  let by: "model" | "code" = "code";
  let model: string | undefined;
  const { ai } = await aiStatus();
  const spec = doc.nodes[screen]?.meta.spec as ScreenSpec | undefined;
  /** Ask Qalam AI for these parts (again, with what didn't pass). */
  const write = async (which: typeof needing, fix?: Map<string, string[]>) => {
    const body: PartsInput = {
      stage: "parts",
      screen: describeScreen(doc, screen),
      platform: (spec?.platform as PartsInput["platform"]) ?? "mobile",
      lang: spec?.lang === "ar" ? "ar" : "en",
      dir: spec?.dir === "rtl" ? "rtl" : "ltr",
      parts: which.map((s) => {
        const issues = fix?.get(s.candidate.id);
        const previous = issues && written.get(s.candidate.id);
        return {
          candidate: s.candidate.id,
          kind: s.candidate.needs!.kind,
          role: s.candidate.needs!.role,
          label: s.label,
          ...(s.plan ? { plan: s.plan } : {}),
          about: about(doc, screen, s.candidate),
          ...(issues ? { issues: issues.map((x) => x.slice(0, 300)).slice(0, 8) } : {}),
          ...(previous ? { previous: JSON.stringify({ header: previous.header, body: previous.body, footer: previous.footer }).slice(0, 12_000) } : {}),
        };
      }),
    };
    const res = await callAI<PartsResult>("/api/prototype", body, onProgress, signal);
    model = res.model;
    by = "model";
    for (const p of res.data.parts ?? []) {
      const s = which.find((x) => x.candidate.id === p.candidate);
      const part = s ? asSpec(doc, screen, p, s.candidate.needs!.kind) : null;
      if (s && part) written.set(s.candidate.id, part);
    }
  };
  if (needing.length && ai) await write(needing);
  signal.throwIfAborted();
  const ts = tokenSetFor(dsIdForNode(doc, screen));
  const run = () => buildSteps(doc, screen, picked.map((s) => ({ candidate: s.candidate, label: s.label, part: written.get(s.candidate.id) })), { typography: (p) => ts.typography(p) });
  let out = run();
  // Parts Qalam AI wrote that didn't pass get one try at a fix; a fix that still doesn't pass leaves code's in.
  const rejected = new Map(out.results.filter((r) => r.rejected?.length).map((r) => [r.id, r.rejected!]));
  if (rejected.size && ai) {
    await write(needing.filter((s) => rejected.has(s.candidate.id)), rejected);
    signal.throwIfAborted();
    const again = run();
    const fixed = (o: typeof out) => o.results.filter((r) => r.ok && r.wrote === "model").length;
    if (fixed(again) >= fixed(out)) out = again;
  }
  // What the brief asked for was answered by this proposal: built, or listed with why not.
  commit(doc, out.doc, screen, out.appVars, proposal.by === "model");
  return { results: out.results, by, ...(model ? { model } : {}) };
}

/** What the build added to the document — the parts' layers, the route, the app's values — as one undo step; `answered` takes the asks waiting on the screen. */
function commit(before: Doc, after: Doc, screen: string, appVars: Record<string, unknown>, answered: boolean) {
  const added = after.roots.filter((id) => !before.nodes[id]);
  const nodes: SceneNode[] = [];
  const collect = (id: string) => {
    const n = after.nodes[id];
    if (!n) return;
    nodes.push(n);
    n.children.forEach(collect);
  };
  added.forEach(collect);
  const route = after.proto?.routes?.[screen];
  if (!route) return;
  const st = studio();
  st.beginTx();
  if (nodes.length) insertNodes(nodes, null, undefined, false);
  editRoutes((p) => ({ ...withRoute(p, screen, () => (answered ? withoutAsks(route) : route)), vars: { ...p.vars, ...(appVars as typeof p.vars) } }));
  st.commitTx();
}
