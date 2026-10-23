/**
 * The Knowledge hub's graph, built from the stores that hold Qalam AI's knowledge (pure). One
 * adapter per store adds its facts; decisions come from recorded traces, or (for turns made before
 * tracing) from what the turn produced. Nothing here is a second copy of the knowledge.
 */
import { COMPONENT_NAMES } from "@/design-system/components";
import { TOPIC_LABEL } from "@/doc/brief";
import type { Doc } from "@/doc/schema";
import type { Chat, ChatTurn } from "@/ui/ai/chatTypes";
import { TOOL_LABEL } from "@/ui/ai/chatTypes";
import type { NamingDecision } from "@/ui/ai/aiStore";
import { systemFacts, type DsFact, type PromptSystem } from "./facts";
import { factHash, ref } from "./refs";
import type { DecisionInfo, DecisionKind, DecisionTrace, EdgeKind, Group, KnowledgeControls, KnowledgeEdge, KnowledgeGraph, KnowledgeNode, NodeKind, Origin, Provenance } from "./types";

export interface SystemInput {
  id: string;
  name: string;
  source: "builtin" | "extracted" | "imported" | "interview" | "freeform";
  createdAt: number;
  /** What the prompt is built from (promptSystem of its payload). */
  prompt: PromptSystem;
  provenance?: Record<string, Provenance>;
  /** The system it was copied from: a copy of the built-in one keeps its rules as built in. */
  forkedFrom?: string;
}

export interface GraphInputs {
  doc: Pick<Doc, "nodes" | "roots" | "brief">;
  systems: SystemInput[];
  naming: NamingDecision[];
  chats: Chat[];
  traces: DecisionTrace[];
  controls?: KnowledgeControls;
  /** Decisions kept on the graph (the latest ones up to `asOf`); older ones fold into the timeline. */
  window?: number;
  /** The timeline's moment: facts learned and decisions made later are left out. */
  asOf?: number;
}

export const DECISION_WINDOW = 12;
/** Requests that record what they relied on; the rest show only what they made. */
export const TRACED = new Set<DecisionKind>(["generate", "section", "critique", "fix", "tune"]);
const MAX_TOKENS = 80;
const MAX_COMPONENTS = 60;
const BRIEF_ANSWERS_SENT = 30;

/** Which colour group a fact's origin puts it in. */
export function groupOf(origin: Origin): Group {
  switch (origin) {
    case "you":
    case "interview":
    case "discovery":
      return "you";
    case "built-in":
    case "extraction":
    case "imported":
      return "system";
    case "web":
      return "research";
    default:
      return "learned";
  }
}

/** Where a brief answer came from, read from its id (critique answers are the designer's own words). */
export function answerOrigin(id: string): Origin {
  if (id.startsWith("interview:")) return "interview";
  if (id.startsWith("ost:")) return "discovery";
  return "you";
}

const SYSTEM_ORIGIN: Record<SystemInput["source"], Origin> = { builtin: "built-in", extracted: "extraction", imported: "imported", interview: "interview", freeform: "ai" };

const clip = (t: string, n = 48) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

const TOOL_KIND: Partial<Record<ChatTurn["tool"], DecisionKind>> = {
  generate: "generate",
  critique: "critique",
  detective: "detective",
  audit: "audit",
  direction: "direction",
  tune: "tune",
  extract: "extract",
  component: "component",
  discovery: "discovery",
};

const TOKEN_PATH = /\b(?:bg|text|icon|border|color|radius|space|shadow|font|layout|type|gradient|motion|size)\.[a-z0-9][a-z0-9.-]*[a-z0-9]/g;
const COMPONENT_RE = new RegExp(`\\b(${[...COMPONENT_NAMES].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");

/** Doc list targets of Tune changes → the fact key prefix their items use. */
const TUNE_LISTS: Record<string, string> = { "language.dos": "lang.dos", "language.donts": "lang.donts", "layout.rules": "layout.rules" };

export function buildKnowledgeGraph(inp: GraphInputs): KnowledgeGraph {
  const asOf = inp.asOf ?? Infinity;
  const nodes = new Map<string, KnowledgeNode>();
  const edges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();
  const forgotten = inp.controls?.forgotten ?? {};
  const pinned = inp.controls?.pinned ?? {};

  const add = (n: Omit<KnowledgeNode, "status" | "usage" | "group"> & { group?: Group; status?: KnowledgeNode["status"] }): KnowledgeNode | null => {
    if (n.at > asOf) return null;
    const existing = nodes.get(n.ref);
    if (existing) return existing;
    const node: KnowledgeNode = {
      ...n,
      group: n.group ?? groupOf(n.origin),
      status: forgotten[n.ref] ? "forgotten" : (n.status ?? "active"),
      usage: { given: 0, relied: 0 },
      ...(pinned[n.ref] ? { pinned: true } : {}),
    };
    nodes.set(n.ref, node);
    return node;
  };
  const link = (from: string, to: string, kind: EdgeKind, why?: string) => {
    const k = `${from}>${to}>${kind}`;
    if (from === to || edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push({ from, to, kind, ...(why ? { why } : {}) });
  };
  /** Anchors are added only when something links to them. */
  const screenAnchor = (frameId: string): string | null => {
    const n = inp.doc.nodes[frameId];
    if (!n) return null;
    add({ ref: ref.screen(frameId), kind: "screen", group: "anchor", label: n.name, text: n.name, origin: "you", at: 0, readOnly: true, frameId });
    return ref.screen(frameId);
  };
  const tokenLinks = new Map<string, Set<string>>();
  const componentLinks = new Map<string, Set<string>>();
  const want = (m: Map<string, Set<string>>, key: string, from: string) => {
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(from);
  };

  // --- The brief: what the designer told the critic, and what the critic concluded.
  const b = inp.doc.brief;
  if (b) {
    if (b.summary.trim()) add({ ref: ref.summary, kind: "summary", label: "What the project solves", text: b.summary, origin: "critique", at: b.updatedAt, readOnly: false });
    const sentFrom = Math.max(0, b.answers.length - BRIEF_ANSWERS_SENT);
    b.answers.forEach((a, i) => {
      const r = ref.answer(a.id);
      const node = add({
        ref: r,
        kind: "answer",
        label: `${TOPIC_LABEL[a.topic]}: ${clip(a.answer, 40)}`,
        text: a.answer,
        detail: a.question,
        origin: answerOrigin(a.id),
        at: a.at,
        status: i < sentFrom && !pinned[r] ? "capped" : "active",
      });
      if (node) for (const id of a.screenIds) {
        const s = screenAnchor(id);
        if (s) link(r, s, "about");
      }
    });
    for (const [id, s] of Object.entries(b.screens)) {
      if (!inp.doc.nodes[id]) continue;
      const name = inp.doc.nodes[id].name;
      const goal = [s.goal && `Goal: ${s.goal}`, s.firstNotice && `Noticed first: ${s.firstNotice}`, s.primaryAction && `Primary action: ${s.primaryAction}`].filter(Boolean).join("\n");
      if (goal && add({ ref: ref.screenGoal(id), kind: "screen-goal", label: `${name} · goal`, text: goal, origin: "you", at: b.updatedAt })) {
        const a = screenAnchor(id);
        if (a) link(ref.screenGoal(id), a, "about");
      }
      const lc = s.lastCritique;
      if (lc && add({ ref: ref.verdict(id), kind: "verdict", label: `${name} · ${lc.verdict === "meets" ? "meets goal" : lc.verdict === "misses" ? "misses goal" : lc.verdict}`, text: lc.headline, detail: lc.keyIssues.join("\n"), origin: "critique", at: lc.at, readOnly: true })) {
        const a = screenAnchor(id);
        if (a) link(ref.verdict(id), a, "about");
      }
    }
  }

  // --- Design systems: their written rules, as the prompt reads them.
  const factIndex = new Map<string, Map<string, DsFact>>();
  for (const sys of inp.systems) {
    const { facts } = systemFacts(sys.prompt.name, sys.prompt.docs, sys.prompt.tokens, sys.prompt.inferred);
    const sysRef = ref.system(sys.id);
    add({ ref: sysRef, kind: "system", group: "anchor", label: sys.name, text: `Design system “${sys.name}”`, origin: SYSTEM_ORIGIN[sys.source], at: sys.createdAt, readOnly: true });
    const byKey = new Map<string, DsFact>();
    factIndex.set(sys.id, byKey);
    const ownOrigin: Origin = sys.forkedFrom === "builtin" ? "built-in" : SYSTEM_ORIGIN[sys.source];
    const ownAt = ownOrigin === "built-in" ? 0 : sys.createdAt;
    const guides = new Map((sys.prompt.docs?.components ?? []).filter(Boolean).map((g) => [`guide:${g.component.slice(0, 60)}`, g]));
    const templates = sys.prompt.docs?.layout?.templates ?? [];
    for (const f of facts) {
      byKey.set(f.key, f);
      const r = ref.ds(sys.id, f.key);
      // A copy shares its original's keys: what the designer forgot or pinned there holds here too.
      const alias = sys.forkedFrom ? ref.ds(sys.forkedFrom, f.key) : null;
      const prov = sys.provenance?.[f.key];
      const origin = prov?.origin ?? ownOrigin;
      const node = add({
        ref: r,
        kind: f.kind,
        group: prov ? groupOf(prov.origin) : "system",
        label: f.label,
        text: f.text,
        origin,
        at: prov?.at ?? ownAt,
        systemId: sys.id,
        readOnly: sys.source === "builtin" || f.kind === "tokens" || f.kind === "structure",
        status: alias && forgotten[alias] ? "forgotten" : f.sent ? "active" : f.forgotten ? "forgotten" : "capped",
        ...(alias && pinned[alias] ? { pinned: true } : {}),
        ...(prov ? { provenance: prov } : {}),
      });
      if (!node) continue;
      link(r, sysRef, "part");
      const g = guides.get(f.key);
      if (g) for (const t of g.tokens ?? []) want(tokenLinks, t, r);
      if (f.kind === "template") {
        const t = templates.find((x) => `layout.template#${factHash((x?.name ?? "").slice(0, 60))}` === f.key.replace(/~\d+$/, ""));
        for (const region of t?.regions ?? []) for (const c of region?.components ?? []) if (COMPONENT_NAMES.includes(c)) want(componentLinks, c, r);
      }
      if (f.kind !== "tokens" && f.kind !== "guide" && f.kind !== "structure") {
        for (const m of f.text.matchAll(TOKEN_PATH)) want(tokenLinks, m[0], r);
        for (const m of f.text.matchAll(COMPONENT_RE)) want(componentLinks, m[1], r);
      }
    }
  }
  /** The fact a Tune change added, in the system it changed. */
  const tunedRef = (systemId: string, target: string, text: string): string | null => {
    const prefix = TUNE_LISTS[target];
    const byKey = factIndex.get(systemId);
    if (!byKey) return null;
    if (prefix) {
      const t = text.slice(0, 200);
      for (const [key, f] of byKey) if (key.startsWith(`${prefix}#`) && f.text === t) return ref.ds(systemId, key);
      return null;
    }
    const comp = target.slice(0, target.lastIndexOf("."));
    return byKey.has(`guide:${comp}`) ? ref.ds(systemId, `guide:${comp}`) : null;
  };

  // --- Learned naming: the designer's choices in Token Detective.
  for (const d of inp.naming) {
    if (!d.final) continue;
    add({ ref: ref.naming(d), kind: "naming", label: `${d.value} → ${d.final}`, text: `${d.value} is named ${d.final}${d.final !== d.suggested ? ` (Qalam AI suggested ${d.suggested})` : ""}.${d.intent ? ` ${d.intent}` : ""}`, origin: "detective", at: (d as { at?: number }).at ?? 0 });
  }

  // --- Decisions: traces where they exist, else what a turn produced.
  const traceByTurn = new Map(inp.traces.filter((t) => t.turnId).map((t) => [t.turnId!, t]));
  const turnById = new Map(inp.chats.flatMap((c) => c.turns.map((t) => [t.id, t] as const)));
  type Pending = { ref: string; at: number; chatId?: string; build: () => void };
  const decisions: Pending[] = [];
  const traceTurns = new Set<string>();
  const usage = new Map<string, { given: number; relied: number }>();
  const bump = (r: string, k: "given" | "relied") => {
    const u = usage.get(r) ?? { given: 0, relied: 0 };
    u[k]++;
    usage.set(r, u);
  };
  for (const t of inp.traces) {
    if (t.at > asOf) continue;
    const relied = new Set(t.reliedOn.map((x) => x.ref));
    for (const x of t.reliedOn) bump(x.ref, "relied");
    for (const [r] of t.given) if (!relied.has(r)) bump(r, "given");
  }
  for (const t of inp.traces) {
    if (t.turnId) traceTurns.add(t.turnId);
    const r = ref.decision(t.id);
    decisions.push({
      ref: r,
      at: t.at,
      chatId: t.chatId,
      build: () => {
        const turn = t.turnId ? turnById.get(t.turnId) : undefined;
        const info: DecisionInfo = {
          kind: t.kind,
          title: t.title,
          summary: t.summary,
          chatId: t.chatId,
          turnId: t.turnId,
          model: t.model,
          status: t.status,
          givenCount: t.given.length,
          reliedOn: t.reliedOn,
          frames: t.produced.frames ?? [],
          request: turn?.request.text,
          about: t.about,
          assumed: t.assumed,
          traceId: t.id,
        };
        if (!add({ ref: r, kind: "decision", group: "decision", label: t.title, text: t.summary ?? t.title, origin: "ai", at: t.at, readOnly: true, decision: info })) return;
        const relied = new Set<string>();
        for (const x of t.reliedOn) {
          relied.add(x.ref);
          // A rule or brief fact removed since still shows what was read; other refs (an earlier decision, research) link only while on the graph.
          if (!nodes.has(x.ref) && (x.ref.startsWith("ds:") || x.ref.startsWith("brief:")))
            add({ ref: x.ref, kind: x.ref.startsWith("ds:") ? "rule" : "answer", group: x.ref.startsWith("ds:") ? "system" : "you", label: clip(x.text), text: x.text, origin: "ai", at: 0, readOnly: true, status: "ghost" });
          link(x.ref, r, "relied", x.why);
        }
        for (const [g] of t.given) if (!relied.has(g) && nodes.has(g)) link(g, r, "given");
        for (const f of t.produced.frames ?? []) {
          const s = screenAnchor(f);
          if (s) link(r, s, "produced");
        }
        for (const x of t.produced.refs ?? []) if (nodes.has(x)) link(r, x, "produced");
        for (const p of t.produced.tokens ?? []) want(tokenLinks, p, r);
        if (t.produced.systemId && nodes.has(ref.system(t.produced.systemId))) link(r, ref.system(t.produced.systemId), "produced");
        for (const a of t.about ?? []) {
          const s = screenAnchor(a);
          if (s) link(r, s, "about");
        }
        if (t.parentId && nodes.has(ref.decision(t.parentId))) link(ref.decision(t.parentId), r, "parent");
      },
    });
  }
  for (const chat of inp.chats) {
    for (const turn of chat.turns) {
      const kind = TOOL_KIND[turn.tool];
      if (!kind || (turn.status === "error" && !turn.outcome)) continue;
      const trace = traceByTurn.get(turn.id);
      const r = trace ? ref.decision(trace.id) : ref.decision(`turn:${turn.id}`);
      // Research the turn ran first: notes handed to the model, and the sources they cite.
      const research = turn.research && (turn.research.notes || turn.research.sources.length) ? turn.research : null;
      if (!traceTurns.has(turn.id))
        decisions.push({
          ref: r,
          at: turn.at,
          chatId: chat.id,
          build: () => {
            const info = legacyInfo(turn, chat.id, kind);
            if (!add({ ref: r, kind: "decision", group: "decision", label: info.title, text: info.summary ?? info.title, origin: "ai", at: turn.at, readOnly: true, decision: info })) return;
            legacyEdges(turn, r);
          },
        });
      if (research) {
        const prev = decisions.find((d) => d.ref === r)!;
        const build = prev.build;
        prev.build = () => {
          build();
          if (!nodes.has(r)) return;
          const rr = ref.research(turn.id);
          add({ ref: rr, kind: "research", label: `Looked up · ${clip(turn.request.text, 32)}`, text: research.notes || research.steps.join("\n"), detail: research.steps.join("\n"), origin: "web", at: turn.at, readOnly: true });
          link(rr, r, "given");
          for (const s of research.sources.slice(0, 12)) {
            const sr = ref.source(s.url);
            add({ ref: sr, kind: "source", label: clip(s.title || s.url, 40), text: s.title || s.url, detail: s.url, origin: "web", at: turn.at, readOnly: true });
            link(rr, sr, "source");
          }
        };
      }
    }
  }

  function legacyInfo(turn: ChatTurn, chatId: string, kind: DecisionKind): DecisionInfo {
    const o = turn.outcome;
    const frames = o?.kind === "generate" ? o.frameIds : [];
    const summary = o?.kind === "generate" ? o.approach : o?.kind === "critique" ? o.summary : o?.kind === "tune" ? o.diagnosis : undefined;
    return {
      kind,
      title: `${TOOL_LABEL[turn.tool]} · ${clip(turn.request.text || turn.request.screens?.map((s) => s.name).join(", ") || TOOL_LABEL[turn.tool], 36)}`,
      summary,
      chatId,
      turnId: turn.id,
      model: turn.model,
      status: turn.status === "running" ? "running" : turn.status === "error" ? "error" : turn.status === "stopped" ? "stopped" : "done",
      legacy: true,
      untraced: !TRACED.has(kind),
      givenCount: 0,
      reliedOn: [],
      frames,
      request: turn.request.text,
      about: turn.request.screens?.map((s) => s.id),
    };
  }
  function legacyEdges(turn: ChatTurn, r: string) {
    const o = turn.outcome;
    for (const s of turn.request.screens ?? []) {
      const a = screenAnchor(s.id);
      if (a) link(r, a, "about");
    }
    if (o?.kind === "generate")
      for (const f of o.frameIds) {
        const a = screenAnchor(f);
        if (a) link(r, a, "produced");
      }
    if (o?.kind === "tune" && o.applied) {
      for (const c of o.changes) {
        if (!c.picked || c.problem) continue;
        if (c.kind === "token") {
          want(tokenLinks, c.path, r);
          continue;
        }
        if (c.op !== "add") continue;
        const fr = tunedRef(o.applied.systemId, c.target, c.text);
        if (!fr) continue;
        link(r, fr, "produced");
        // Facts Tune added are learned: keep its reason on the rule.
        const n = nodes.get(fr);
        if (n && !n.provenance) {
          n.provenance = { origin: "tune", at: o.applied.at, turnId: turn.id, reason: c.reason, decisionId: r.slice("decision:".length) };
          n.origin = "tune";
          n.group = "learned";
          n.at = o.applied.at;
        }
      }
    }
    if (o?.kind === "extract" && o.saved && nodes.has(ref.system(o.saved.systemId))) link(r, ref.system(o.saved.systemId), "produced");
    if (o?.kind === "detective" && o.added) for (const p of o.added.paths) want(tokenLinks, p, r);
    if (o?.kind === "component" && o.added && !o.removed) {
      const pr = ref.ds(o.added.systemId, `pattern:${o.added.name.slice(0, 60)}`);
      if (nodes.has(pr)) link(r, pr, "produced");
    }
  }

  // Keep the latest decisions up to the timeline's moment; older ones fold into it.
  const shown = decisions.filter((d) => d.at <= asOf).sort((a, b) => a.at - b.at);
  const window = inp.window ?? DECISION_WINDOW;
  const kept = shown.slice(-window);
  for (const d of kept) d.build();
  // Chat memory: each turn of a chat sees the ones before it.
  const lastInChat = new Map<string, string>();
  for (const d of kept) {
    if (!d.chatId || !nodes.has(d.ref)) continue;
    const prev = lastInChat.get(d.chatId);
    if (prev) link(prev, d.ref, "context");
    lastInChat.set(d.chatId, d.ref);
  }

  // Token and component anchors, the most linked first.
  const anchors = (m: Map<string, Set<string>>, max: number, make: (key: string) => string, kind: NodeKind, kindEdge: EdgeKind) => {
    [...m.entries()]
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, max)
      .forEach(([key, from]) => {
        const r = make(key);
        add({ ref: r, kind, group: "anchor", label: key, text: key, origin: "built-in", at: 0, readOnly: true });
        for (const f of from) if (nodes.has(f)) link(f, r, f.startsWith("decision:") ? "produced" : kindEdge);
      });
  };
  anchors(tokenLinks, MAX_TOKENS, ref.token, "token", "uses");
  anchors(componentLinks, MAX_COMPONENTS, ref.component, "component", "mentions");

  for (const [r, u] of usage) {
    const n = nodes.get(r);
    if (n) n.usage = u;
  }
  const live = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  const list = [...nodes.values()];
  return { nodes: list, edges: live, byRef: nodes, earlier: shown.length - kept.length };
}
