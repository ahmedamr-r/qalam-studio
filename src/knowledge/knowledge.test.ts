import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contrastRatio } from "@/design-system/resolve";
import { BUILTIN_BLOCK } from "@/ai/prompts";
import { BUILTIN_DOCS } from "@/design-system/docs";
import type { Doc, FrameNode } from "@/doc/schema";
import type { Chat, ChatTurn } from "@/ui/ai/chatTypes";
import { promptSystem, systemFacts } from "./facts";
import { buildKnowledgeGraph, answerOrigin, type GraphInputs } from "./graph";
import { layoutGraph } from "./layout";
import { nearestInDirection, pickLabels, labelRect } from "./lod";
import { dsKeyOf, factHash, listKeys, ref } from "./refs";
import type { DecisionTrace } from "./types";

const builtin = promptSystem();

function frame(id: string, name: string): FrameNode {
  return { id, type: "frame", name, x: 0, y: 0, w: 390, h: 844, children: [], meta: {} } as unknown as FrameNode;
}

function inputs(extra: Partial<GraphInputs> = {}): GraphInputs {
  const doc: Pick<Doc, "nodes" | "roots" | "brief"> = {
    nodes: { f1: frame("f1", "Home"), f2: frame("f2", "Cart") },
    roots: ["f1", "f2"],
    brief: {
      summary: "Riders order food fast.",
      answers: [
        { id: "a1", topic: "audience", question: "Who uses it?", answer: "Riders in a hurry", screenIds: ["f1"], at: 10 },
        { id: "interview:q1", topic: "goal", question: "Goal?", answer: "Order in two taps", screenIds: [], at: 5 },
      ],
      screens: { f1: { name: "Home", goal: "Pick a restaurant", firstNotice: "Search", primaryAction: "Order", lastCritique: { at: 20, verdict: "meets", headline: "Clear", keyIssues: [] } } },
      updatedAt: 20,
    },
  };
  return { doc, systems: [{ id: "builtin", name: "Qalam", source: "builtin", createdAt: 0, prompt: builtin }], naming: [], chats: [], traces: [], ...extra };
}

describe("refs", () => {
  it("hashes the same words the same way, whitespace aside", () => {
    expect(factHash("One  primary\naction")).toBe(factHash("One primary action"));
    expect(factHash("One primary action")).not.toBe(factHash("Two primary actions"));
  });
  it("numbers repeated list items in order", () => {
    const [a, b, c] = listKeys("layout.rules", ["x", "y", "x"]);
    expect(b).not.toBe(a);
    expect(c).toBe(`${a}~2`);
  });
  it("reads a ds ref back", () => {
    expect(dsKeyOf(ref.ds("ds-abc", "layout.rules#k2"))).toEqual({ systemId: "ds-abc", key: "layout.rules#k2" });
    expect(dsKeyOf("brief:summary")).toBeNull();
  });
});

describe("design-system facts", () => {
  it("every built-in fact the prompt sends appears in the built-in block", () => {
    const { facts } = systemFacts(builtin.name, builtin.docs, builtin.tokens);
    const sent = facts.filter((f) => f.sent && f.kind !== "tokens" && f.kind !== "structure" && f.kind !== "template" && f.kind !== "principle");
    expect(sent.length).toBeGreaterThan(10);
    for (const f of sent) expect(BUILTIN_BLOCK).toContain(f.text);
  });
  it("lists items past a limit as not sent, and pinned items go first", () => {
    const rules = Array.from({ length: 18 }, (_, i) => `Rule number ${i + 1}`);
    const docs = { ...BUILTIN_DOCS, layout: { ...BUILTIN_DOCS.layout, rules } };
    const { facts } = systemFacts("X", docs, builtin.tokens);
    const ruleFacts = facts.filter((f) => f.kind === "rule");
    expect(ruleFacts.filter((f) => f.sent)).toHaveLength(16);
    expect(ruleFacts.filter((f) => !f.sent).map((f) => f.text)).toEqual(["Rule number 17", "Rule number 18"]);
    const last = ruleFacts.find((f) => f.text === "Rule number 18")!.key;
    const pinned = systemFacts("X", docs, builtin.tokens, [], { pin: new Set([last]) }).facts.find((f) => f.key === last)!;
    expect(pinned.sent).toBe(true);
  });
  it("tags each sent fact with its id and leaves forgotten ones out", () => {
    const { facts } = systemFacts(builtin.name, builtin.docs, builtin.tokens);
    const rule = facts.find((f) => f.kind === "rule")!;
    const tagged = systemFacts(builtin.name, builtin.docs, builtin.tokens, [], { tags: true });
    const r = tagged.facts.find((f) => f.key === rule.key)!;
    expect(tagged.body).toContain(`[${r.short}] ${rule.text}`);
    const without = systemFacts(builtin.name, builtin.docs, builtin.tokens, [], { tags: true, exclude: new Set([rule.key]) });
    expect(without.body).not.toContain(rule.text);
    expect(without.facts.find((f) => f.key === rule.key)).toMatchObject({ sent: false, forgotten: true });
  });
});

describe("knowledge graph", () => {
  it("reads where brief answers came from by their ids", () => {
    expect(answerOrigin("a12")).toBe("you");
    expect(answerOrigin("interview:q1")).toBe("interview");
    expect(answerOrigin("ost:c1:goal-0")).toBe("discovery");
  });

  it("builds brief, system and anchor nodes with their links", () => {
    const g = buildKnowledgeGraph(inputs());
    expect(g.byRef.get(ref.answer("a1"))?.group).toBe("you");
    expect(g.byRef.get(ref.summary)?.group).toBe("learned");
    expect(g.byRef.get(ref.verdict("f1"))?.group).toBe("learned");
    expect(g.edges).toContainEqual({ from: ref.answer("a1"), to: ref.screen("f1"), kind: "about" });
    // Built-in rules belong to the system and name components, which become anchors.
    const rule = g.nodes.find((n) => n.kind === "rule")!;
    expect(rule.group).toBe("system");
    expect(rule.readOnly).toBe(true);
    expect(g.edges.some((e) => e.from === rule.ref && e.to === ref.system("builtin") && e.kind === "part")).toBe(true);
    expect(g.byRef.get(ref.component("BottomNav"))?.group).toBe("anchor");
    // A screen nothing links to isn't drawn.
    expect(g.byRef.has(ref.screen("f2"))).toBe(false);
  });

  it("shows turns made before tracing by what they produced, with Tune's reason kept on the rule", () => {
    const rule = BUILTIN_DOCS.layout.rules[0];
    const turn = (t: Partial<ChatTurn>): ChatTurn => ({ id: "t", tool: "generate", at: 30, request: { text: "Home" }, status: "done", started: 0, tokens: 0, ...t }) as ChatTurn;
    const chat: Chat = {
      id: "c1",
      title: "x",
      createdAt: 0,
      updatedAt: 0,
      turns: [
        turn({ id: "t1", outcome: { kind: "generate", variants: [], offSystem: [], frameIds: ["f2"] } }),
        turn({
          id: "t2",
          tool: "tune",
          at: 40,
          outcome: {
            kind: "tune",
            systemId: "builtin",
            systemName: "Qalam",
            diagnosis: "",
            limitations: [],
            changes: [{ kind: "guidance", target: "layout.rules", op: "add", text: rule, reason: "Screens felt crowded", picked: true }],
            applied: { at: 41, systemId: "builtin", systemName: "Qalam", forked: false, prevActiveId: "builtin", undo: [] },
          },
        }),
      ],
    };
    const g = buildKnowledgeGraph(inputs({ chats: [chat] }));
    const gen = ref.decision("turn:t1");
    expect(g.byRef.get(gen)?.decision?.legacy).toBe(true);
    expect(g.edges).toContainEqual({ from: gen, to: ref.screen("f2"), kind: "produced" });
    expect(g.edges).toContainEqual({ from: gen, to: ref.decision("turn:t2"), kind: "context" });
    const tuned = g.nodes.find((n) => n.text === rule)!;
    expect(tuned.group).toBe("learned");
    expect(tuned.provenance?.reason).toBe("Screens felt crowded");
  });

  it("draws a trace: relied-on facts, given facts, usage counts and the decision window", () => {
    const g0 = buildKnowledgeGraph(inputs());
    const rule = g0.nodes.find((n) => n.kind === "rule")!;
    const other = g0.nodes.find((n) => n.kind === "do")!;
    const trace = (id: string, at: number): DecisionTrace => ({
      v: 1,
      id,
      projectId: "p",
      kind: "generate",
      at,
      updatedAt: at,
      title: `Generate ${id}`,
      status: "done",
      given: [
        [rule.ref, "h1"],
        [other.ref, "h2"],
        [ref.answer("a1"), "h3"],
      ],
      reliedOn: [{ ref: rule.ref, why: "Kept one primary action", text: rule.text }],
      produced: { frames: ["f1"] },
    });
    const traces = Array.from({ length: 15 }, (_, i) => trace(`d${i}`, 100 + i));
    const g = buildKnowledgeGraph(inputs({ traces }));
    expect(g.edges).toContainEqual({ from: rule.ref, to: ref.decision("d14"), kind: "relied", why: "Kept one primary action" });
    expect(g.edges).toContainEqual({ from: other.ref, to: ref.decision("d14"), kind: "given" });
    expect(g.byRef.get(rule.ref)?.usage).toEqual({ given: 0, relied: 15 });
    expect(g.byRef.get(other.ref)?.usage.given).toBe(15);
    expect(g.nodes.filter((n) => n.kind === "decision")).toHaveLength(12);
    expect(g.earlier).toBe(3);
    // The timeline's moment leaves later decisions out.
    expect(buildKnowledgeGraph(inputs({ traces, asOf: 104 })).nodes.filter((n) => n.kind === "decision")).toHaveLength(5);
  });

  it("marks forgotten and pinned facts, and older answers past the prompt's limit", () => {
    const answers = Array.from({ length: 32 }, (_, i) => ({ id: `a${i}`, topic: "other" as const, question: "q", answer: `Answer ${i}`, screenIds: [], at: i }));
    const base = inputs();
    base.doc.brief!.answers = answers;
    const g = buildKnowledgeGraph({ ...base, controls: { v: 1, forgotten: { [ref.answer("a5")]: 1 }, pinned: { [ref.answer("a0")]: 1 } } });
    expect(g.byRef.get(ref.answer("a1"))?.status).toBe("capped");
    expect(g.byRef.get(ref.answer("a0"))).toMatchObject({ status: "active", pinned: true });
    expect(g.byRef.get(ref.answer("a5"))?.status).toBe("forgotten");
    expect(g.byRef.get(ref.answer("a31"))?.status).toBe("active");
  });
});

describe("layout", () => {
  const g = buildKnowledgeGraph(inputs());

  it("is the same picture every time", () => {
    expect(layoutGraph(g, null, { seed: "p1" })).toEqual(layoutGraph(g, null, { seed: "p1" }));
  });

  it("keeps saved nodes where they are and places new ones beside their neighbours", () => {
    const first = layoutGraph(g, null, { seed: "p1" });
    const fewer = { ...first };
    const answer = ref.answer("a1");
    delete fewer[answer];
    const next = layoutGraph(g, fewer, { seed: "p1" });
    for (const [r, p] of Object.entries(fewer)) expect(next[r]).toEqual(p);
    const screen = next[ref.screen("f1")];
    const d = Math.hypot(next[answer][0] - screen[0], next[answer][1] - screen[1]);
    expect(d).toBeLessThan(200);
  });

  it("gathers each group around its own home", () => {
    const pos = layoutGraph(g, null, { seed: "p1" });
    const mean = (group: string) => {
      const ps = g.nodes.filter((n) => n.group === group).map((n) => pos[n.ref]);
      return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
    };
    const you = mean("you");
    const sys = mean("system");
    expect(you[1]).toBeLessThan(sys[1]);
  });
});

describe("labels and keyboard walking", () => {
  const v = { x: 0, y: 0, k: 1 };
  const items = [
    { ref: "a", x: 10, y: 10, r: 4, label: "Alpha rule", weight: 1 },
    { ref: "b", x: 12, y: 12, r: 4, label: "Beta rule", weight: 5 },
    { ref: "c", x: 300, y: 10, r: 4, label: "Gamma", weight: 0 },
  ];

  it("never overlaps labels, and always labels the selected node", () => {
    const shown = pickLabels(items, v, { w: 800, h: 600 }, new Set(["a"]));
    expect(shown.has("a")).toBe(true);
    expect(shown.has("b")).toBe(false);
    expect(shown.has("c")).toBe(true);
    const ra = labelRect(items[0], v);
    const rc = labelRect(items[2], v);
    expect(ra.x + ra.w).toBeLessThan(rc.x);
  });

  it("walks to the nearest node in a direction", () => {
    const pts = [
      { ref: "o", x: 0, y: 0 },
      { ref: "r", x: 100, y: 5 },
      { ref: "far", x: 400, y: 0 },
      { ref: "u", x: 3, y: -80 },
    ];
    expect(nearestInDirection(pts[0], pts, "right", "o")).toBe("r");
    expect(nearestInDirection(pts[0], pts, "up", "o")).toBe("u");
    expect(nearestInDirection(pts[0], pts, "left", "o")).toBeNull();
  });
});

describe("group colours", () => {
  it("stand out from the panel and canvas in both themes (3:1, WCAG 1.4.11)", () => {
    const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    const light = css.indexOf(':root[data-theme="light"] {');
    const darkBlock = css.slice(css.indexOf("@theme static"), light);
    const lightBlock = css.slice(light);
    const read = (block: string, name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
    for (const [block, surfaces] of [
      [darkBlock, ["panel", "canvas"]],
      [lightBlock, ["panel", "canvas"]],
    ] as const)
      for (const g of ["kh-you", "kh-system", "kh-learned", "kh-research"]) {
        const c = read(block, g);
        expect(c, g).toBeTruthy();
        for (const surface of surfaces) {
          const bg = read(block, surface) ?? read(darkBlock, surface);
          expect(contrastRatio(c!, bg!), `${g} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
  });
});
