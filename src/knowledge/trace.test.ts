import { describe, expect, it } from "vitest";
import { BUILTIN_BLOCK, GENERATE_BASE, blockFor } from "@/ai/prompts";
import { CRITIQUE_SCHEMA, CRITIQUE_SYSTEM } from "@/ai/critique";
import { FIX_BASE } from "@/ai/critique-fix";
import { TUNE_SCHEMA, TUNE_SYSTEM, tuneFacts } from "@/ai/tune";
import { RELIANCE_NOTE, withAssumptions, withReliance } from "@/ai/reliance";
import { SAMPLE_GENERATE } from "@/ai/fixtures";
import { SAMPLE_TUNE } from "@/ai/fixtures-tune";
import { systemPayload } from "@/ai/ds-payload";
import { BUILTIN_DOCS } from "@/design-system/docs";
import { BUILTIN_SYSTEM, useSystems } from "@/design-system/registry";
import type { Doc, FrameNode } from "@/doc/schema";
import { tunePayload } from "@/ui/ai/tune";
import { critiqueBrief, generateBrief } from "./brief";
import { locateDsFact, replaceDsFact } from "./edit";
import { promptSystem, systemFacts } from "./facts";
import { ref } from "./refs";
import { stepAt, steps, timelineEvents } from "./timeline";
import { dsEntries, entry, mergeManifest, mergeTrace, sanitizeAssumed, sanitizeReliance, stripFactIds } from "./trace";
import { knowledgeGaps } from "./gaps";
import { changesNote, changesSince, readRequest, reviseRequest } from "./changes";
import { withKnowledge } from "@/ui/knowledge/record";
import { buildKnowledgeGraph } from "./graph";
import { normalizeControls, remapRef, remapSystem } from "./controls";
import { MAX_ANSWERS, appendAnswer } from "@/doc/brief";

const builtin = promptSystem();

/** The fact's id is in the block, and its words follow it on that line (after a label like "Colour:"). */
function tagged(block: string, short: string, text: string) {
  const i = block.indexOf(`[${short}] `);
  expect(i, short).toBeGreaterThan(-1);
  const line = block.slice(i, block.indexOf("\n", i) < 0 ? undefined : block.indexOf("\n", i));
  expect(line.includes(text.slice(0, 40)) || text.includes("role tokens"), `${short}: ${text.slice(0, 40)}`).toBe(true);
}
const builtinEntries = () => dsEntries("builtin", systemFacts(builtin.name, builtin.docs, builtin.tokens, [], { tags: true }).facts);

describe("relied on: the prompts and schemas", () => {
  it("asks every traced route for reliedOn, last and required", () => {
    for (const p of [GENERATE_BASE, CRITIQUE_SYSTEM, FIX_BASE, TUNE_SYSTEM]) expect(p).toContain(RELIANCE_NOTE);
    for (const sch of [CRITIQUE_SCHEMA, TUNE_SCHEMA, withReliance({ type: "object", properties: { a: {} }, required: ["a"] })]) {
      expect(Object.keys(sch.properties as object).at(-1)).toBe("reliedOn");
      expect((sch.required as string[]).at(-1)).toBe("reliedOn");
    }
  });
});

describe("relied on: code checks what the model says", () => {
  const m = mergeManifest([entry("d4", "ds:builtin:layout.rules#a", "Rule A"), entry("d9", "ds:builtin:lang.dos#b", "Do B")], [entry("b1", ref.summary, "Summary")]);

  it("keeps only ids that were sent, once each, with a short reason and no ids in it", () => {
    const out = sanitizeReliance(
      [
        { id: "[D4]", why: "Kept the one action [d9] rule" },
        { id: "d4", why: "again" },
        { id: "d77", why: "never sent" },
        { id: "b1", why: "x".repeat(400) },
        { id: 5, why: "not an id" },
      ],
      m,
    );
    expect(out.map((x) => x.ref)).toEqual(["ds:builtin:layout.rules#a", ref.summary]);
    expect(out[0].why).toBe("Kept the one action rule");
    expect(out[0].text).toBe("Rule A");
    expect(out[1].why).toHaveLength(200);
    expect(sanitizeReliance("nope", m)).toEqual([]);
  });

  it("stops at eight", () => {
    const many = mergeManifest(Array.from({ length: 12 }, (_, i) => entry(`d${i + 1}`, `ds:x:k${i}`, `t${i}`)));
    expect(sanitizeReliance(Array.from({ length: 12 }, (_, i) => ({ id: `d${i + 1}`, why: "" })), many)).toHaveLength(8);
  });

  it("strips ids a model copied into prose", () => {
    expect(stripFactIds("Keep it calm [d12] and warm [b3, c2].")).toBe("Keep it calm and warm.");
  });

  it("merges a critique's turns: given adds up, the latest reason wins", () => {
    const a = { given: [["x", "1"]] as [string, string][], reliedOn: [{ ref: "x", why: "first", text: "" }] };
    const b = { given: [["y", "2"]] as [string, string][], reliedOn: [{ ref: "x", why: "later", text: "" }] };
    const out = mergeTrace(a, b);
    expect(out.given.map((g) => g[0])).toEqual(["x", "y"]);
    expect(out.reliedOn).toEqual([{ ref: "x", why: "later", text: "" }]);
  });
});

describe("the ids the client records are the ones the model reads", () => {
  it("numbers the built-in block as the client does", () => {
    for (const e of builtinEntries()) tagged(BUILTIN_BLOCK, e.short, e.text);
    expect(blockFor({ id: "builtin" })).toBe(BUILTIN_BLOCK);
    expect(blockFor(systemPayload(BUILTIN_SYSTEM))).toBe(BUILTIN_BLOCK);
  });

  it("leaves forgotten facts out and numbers the rest the same on both sides", () => {
    const rule = builtinEntries().find((e) => e.ref.includes("layout.rules#"))!;
    const key = rule.ref.slice("ds:builtin:".length);
    const block = blockFor({ id: "builtin", knowledge: { exclude: [key] } });
    expect(block).not.toContain(rule.text);
    const client = dsEntries("builtin", systemFacts(builtin.name, builtin.docs, builtin.tokens, [], { tags: true, exclude: new Set([key]) }).facts);
    for (const e of client) tagged(block, e.short, e.text);
  });

  it("sample answers cite facts the built-in prompts really send", () => {
    const gen = mergeManifest(builtinEntries());
    expect(sanitizeReliance(SAMPLE_GENERATE.reliedOn, gen)).toHaveLength(SAMPLE_GENERATE.reliedOn!.length);
    const tune = mergeManifest(dsEntries("builtin", tuneFacts(tunePayload(BUILTIN_SYSTEM))));
    expect(sanitizeReliance(SAMPLE_TUNE.reliedOn, tune)).toHaveLength(SAMPLE_TUNE.reliedOn!.length);
  });
});

function frame(id: string, name: string): FrameNode {
  return { id, type: "frame", name, x: 0, y: 0, w: 390, h: 844, children: [], meta: {} } as unknown as FrameNode;
}

describe("the brief as requests send it", () => {
  const answers = Array.from({ length: 34 }, (_, i) => ({ id: `a${i}`, topic: "other" as const, question: `q${i}`, answer: `Answer ${i}`, screenIds: [], at: i }));
  const doc = {
    nodes: { f1: frame("f1", "Home") },
    roots: ["f1"],
    brief: { summary: "Riders order fast.", answers, screens: { f1: { name: "Home", goal: "Pick a place", firstNotice: "", primaryAction: "Order" } }, updatedAt: 1 },
  } as unknown as Doc;
  const controls = { v: 1 as const, forgotten: { [ref.answer("a33")]: 1 }, pinned: { [ref.answer("a0")]: 1 } };

  it("critique: ids in front of each fact, pinned answers past the limit, forgotten ones out", () => {
    const { payload, entries } = critiqueBrief(doc.brief, doc, ["f1"], Infinity, controls);
    expect(payload.summary).toBe("[b1] Riders order fast.");
    const sent = payload.answers.map((a) => a.answer.replace(/^\[b\d+\] /, ""));
    expect(sent).toContain("Answer 0");
    expect(sent).not.toContain("Answer 33");
    expect(sent).not.toContain("Answer 1");
    expect(payload.screens[0].goal).toMatch(/^\[b\d+\] Pick a place$/);
    expect(payload.screens[0].primaryAction).toBe("Order");
    const goal = entries.find((e) => e.ref === ref.screenGoal("f1"))!;
    expect(goal.text).toBe("Pick a place · Order");
    for (const a of payload.answers) expect(entries.some((e) => a.answer.startsWith(`[${e.short}] `))).toBe(true);
  });

  it("generate: the summary, the screens' goals and pinned answers only", () => {
    const { text, entries } = generateBrief(doc.brief, doc, ["f1"], controls);
    expect(text).toContain("[b1] Riders order fast.");
    expect(text).toMatch(/Screen "Home": \[b2\] goal: Pick a place; primary action: Order/);
    expect(text).toContain("Answer 0");
    expect(text).not.toContain("Answer 5");
    expect(entries.map((e) => e.ref)).toEqual([ref.summary, ref.screenGoal("f1"), ref.answer("a0")]);
  });
});

describe("editing a rule from the hub", () => {
  it("finds the item a key names and gives the edited item its new key", () => {
    const key = builtinEntries().find((e) => e.text === "One primary action per screen")!.ref.slice("ds:builtin:".length);
    expect(locateDsFact(BUILTIN_DOCS, key)).toEqual({ prefix: "lang.dos", index: 0 });
    const out = replaceDsFact(BUILTIN_DOCS, key, "One primary action, pinned in the footer");
    if ("error" in out) throw new Error(out.error);
    expect(out.docs.language.dos[0]).toBe("One primary action, pinned in the footer");
    expect(out.key).not.toBe(key);
    expect(BUILTIN_DOCS.language.dos[0]).toBe("One primary action per screen");
    expect(replaceDsFact(BUILTIN_DOCS, "lang.voice", "Warm")).toMatchObject({ key: "lang.voice" });
    expect(replaceDsFact(BUILTIN_DOCS, "guide:Button", "x")).toHaveProperty("error");
  });
});

describe("timeline", () => {
  it("steps through the moments facts were learned and decisions made", () => {
    const doc = { nodes: {}, roots: [], brief: { summary: "", answers: [{ id: "a1", topic: "goal" as const, question: "", answer: "Fast", screenIds: [], at: 100 }], screens: {}, updatedAt: 0 } };
    const g = buildKnowledgeGraph({ doc, systems: [], naming: [], chats: [], traces: [{ v: 1, id: "t", projectId: "p", kind: "generate", at: 200, updatedAt: 200, title: "Gen", status: "done", given: [], reliedOn: [], produced: {} }], window: Infinity });
    const ev = timelineEvents(g);
    expect(ev.map((e) => e.kind)).toEqual(["fact", "decision"]);
    const st = steps(ev);
    expect(st).toEqual([100, 200]);
    expect(stepAt(st, null)).toBe(2);
    expect(stepAt(st, 150)).toBe(0);
    expect(stepAt(st, 50)).toBe(-1);
  });
});

describe("forget and pin", () => {
  it("reads controls back defensively and moves them with a system's copy or an edited rule", () => {
    expect(normalizeControls({ forgotten: {}, pinned: {} })).toBeUndefined();
    expect(normalizeControls({ forgotten: { a: 1, b: "x" }, pinned: null })).toEqual({ v: 1, forgotten: { a: 1 }, pinned: {} });
    const c = { v: 1 as const, forgotten: { "ds:builtin:layout.rules#k": 5 }, pinned: { "ds:builtin:lang.dos#d": 6, "brief:summary": 7 } };
    const forked = remapSystem(c, "builtin", "edited-x");
    expect(forked.forgotten["ds:edited-x:layout.rules#k"]).toBe(5);
    expect(forked.pinned["ds:edited-x:lang.dos#d"]).toBe(6);
    expect(forked.pinned["brief:summary"]).toBe(7);
    const moved = remapRef(c, "ds:builtin:lang.dos#d", "ds:builtin:lang.dos#e");
    expect(moved.pinned).toEqual({ "brief:summary": 7, "ds:builtin:lang.dos#e": 6 });
  });

  it("never trims a pinned answer when the brief is full", () => {
    let b = undefined as Parameters<typeof appendAnswer>[0];
    const mk = (i: number) => ({ id: `a${i}`, topic: "other" as const, question: "", answer: `A${i}`, screenIds: [], at: i });
    for (let i = 0; i < MAX_ANSWERS + 5; i++) b = appendAnswer(b, mk(i), (id) => id === "a0");
    expect(b!.answers).toHaveLength(MAX_ANSWERS);
    expect(b!.answers[0].id).toBe("a0");
    expect(b!.answers.at(-1)!.id).toBe(`a${MAX_ANSWERS + 4}`);
    expect(b!.answers.some((a) => a.id === "a1")).toBe(false);
  });
});

describe("why this design: what it didn't know, and what changed since", () => {
  const doc = {
    nodes: { f1: frame("f1", "Wallet") },
    roots: ["f1"],
    brief: { summary: "", answers: [], screens: { f1: { name: "Wallet", goal: "See the balance", firstNotice: "", primaryAction: "" } }, updatedAt: 1 },
  } as unknown as Doc;

  it("keeps known guesses only, and puts its guesses before the plain gaps", () => {
    expect(sanitizeAssumed([{ topic: "audience", guess: "Riders [b2]" }, { topic: "weather", guess: "x" }, { topic: "goal", guess: "" }])).toEqual([{ topic: "audience", guess: "Riders" }]);
    const gaps = knowledgeGaps(doc.brief, doc, "f1", [
      { topic: "audience", guess: "Commuters" },
      { topic: "goal", guess: "Already known, so dropped" },
    ]);
    expect(gaps[0]).toMatchObject({ topic: "audience", guess: "Commuters", screenId: "f1" });
    expect(gaps.map((g) => g.topic)).toEqual(["audience", "first-notice", "primary-action", "problem"]);
    expect(gaps.find((g) => g.topic === "first-notice")).toMatchObject({ field: "firstNotice", screenId: "f1" });
    expect(gaps.find((g) => g.topic === "problem")).toMatchObject({ field: "summary" });
  });

  it("puts assumed before reliedOn in the schema", () => {
    const sch = withAssumptions(withReliance({ type: "object", properties: { a: {} }, required: ["a"] }));
    expect(Object.keys(sch.properties as object)).toEqual(["a", "assumed", "reliedOn"]);
    expect(sch.required).toEqual(["a", "assumed", "reliedOn"]);
  });

  it("lists what the designer forgot, edited and told it since the decision", () => {
    const g0 = buildKnowledgeGraph({ doc, systems: [{ id: "builtin", name: "Qalam", source: "builtin", createdAt: 0, prompt: promptSystem() }], naming: [], chats: [], traces: [] });
    const rule = g0.nodes.find((n) => n.kind === "rule")!;
    const doRule = g0.nodes.find((n) => n.kind === "do")!;
    const t = {
      at: 100,
      given: [
        [rule.ref, "h"],
        [doRule.ref, "h"],
        [ref.screenGoal("f1"), entry("b1", ref.screenGoal("f1"), "Old goal").hash],
      ] as [string, string][],
      reliedOn: [{ ref: ref.screenGoal("f1"), why: "", text: "Old goal" }],
      about: ["f1"],
      produced: {},
    };
    const later = {
      ...doc,
      knowledge: { v: 1 as const, forgotten: { [rule.ref]: 200 }, pinned: {} },
      brief: { ...doc.brief!, answers: [{ id: "a9", topic: "audience" as const, question: "Who uses it?", answer: "Commuters", screenIds: ["f1"], at: 300 }] },
    };
    const changes = changesSince(t, buildKnowledgeGraph({ doc: later, systems: [{ id: "builtin", name: "Qalam", source: "builtin", createdAt: 0, prompt: promptSystem() }], naming: [], chats: [], traces: [], controls: later.knowledge }), later);
    expect(changes.map((c) => c.kind).sort()).toEqual(["edited", "forgot", "told"]);
    expect(changes.find((c) => c.kind === "edited")).toMatchObject({ before: "Old goal", text: "See the balance" });
    const note = changesNote(changes);
    expect(note).toContain("stop following");
    expect(note).toContain('"Old goal" is now "See the balance"');
    expect(note).toContain('I told you who uses it: "Commuters"');
  });
});

describe("generate again", () => {
  it("writes the changes and the first request, and reads them back", () => {
    const text = reviseRequest('stop following "Hero on landing screens"; I told you who uses it: "Commuters"', "Make the balance easier to read");
    expect(text.length).toBeLessThanOrEqual(800);
    expect(readRequest(text)).toEqual({ revise: true, changes: ['stop following "Hero on landing screens"', 'I told you who uses it: "Commuters"'], original: "Make the balance easier to read" });
    expect(readRequest("A wallet home")).toEqual({ revise: false, changes: [], original: "A wallet home" });
    // A fact's own semicolons stay with it.
    expect(readRequest(reviseRequest('stop following "Lead with a hero; task screens stay flat"; updated: "x"', "Y")).changes).toEqual(['stop following "Lead with a hero; task screens stay flat"', 'updated: "x"']);
    // A revision of a revision still names the first request.
    expect(readRequest(reviseRequest("x", readRequest(text).original)).original).toBe("Make the balance easier to read");
  });

  it("applies what was forgotten on a system to its copy", () => {
    const copy = { ...BUILTIN_SYSTEM, id: "edited-copy", name: "Qalam (edited)", source: "imported" as const, forkedFrom: "builtin" };
    useSystems.getState().add(copy, false);
    const p = withKnowledge(systemPayload(copy), { v: 1, forgotten: { "ds:builtin:layout.rules#k": 1, "ds:other:x#y": 1 }, pinned: { "ds:edited-copy:lang.dos#d": 2 } });
    expect(p.knowledge).toEqual({ exclude: ["layout.rules#k"], pin: ["lang.dos#d"] });
    useSystems.getState().remove("edited-copy");
  });
});
