import { describe, expect, it } from "vitest";
import { CritiqueBody, IMAGE_BUDGET, buildCritiqueContent, type CritiqueRequest } from "./critique-request";
import { CRITIQUE_SCHEMA, MAX_QUESTIONS } from "./critique";
import { SAMPLE_CRITIQUE_TURNS } from "./fixtures-critique";
import { briefForRequest, emptyBrief, appendAnswer } from "@/doc/brief";
import { makeFrame } from "@/doc/factory";

const body = (p: Partial<CritiqueRequest> = {}): CritiqueRequest => ({
  screens: [{ id: "s1", name: "Tracking", outline: "s1 · frame · \"Tracking\"", image: "iVBORw0KGgo=" }],
  lint: [{ nodeId: "n1", rule: "contrast", severity: "error", message: "2.1:1" }],
  brief: { summary: "", answers: [], screens: [], otherScreens: [] },
  transcript: [],
  reported: [],
  mustConclude: false,
  ...p,
});

/** Every object lists all of its properties as required (structured outputs need this). */
function openRequired(node: unknown, path = "#"): string[] {
  if (!node || typeof node !== "object") return [];
  const o = node as Record<string, unknown>;
  const out: string[] = [];
  if (o.type === "object") {
    const keys = Object.keys(o.properties as object).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...(o.required as string[])].sort())) out.push(path);
  }
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...openRequired(x, `${path}.${k}[${i}]`)));
    else out.push(...openRequired(v, `${path}.${k}`));
  }
  return out;
}

describe("critique request", () => {
  it("schema requires every property", () => {
    expect(openRequired(CRITIQUE_SCHEMA)).toEqual([]);
  });

  it("accepts a request built from the Knowledge hub", () => {
    const f = makeFrame({ name: "Tracking" });
    const doc = { nodes: { [f.id]: f }, roots: [f.id] };
    const brief = appendAnswer(emptyBrief(), { id: "a", topic: "goal", question: "Q", answer: "A", screenIds: [f.id], at: 1 });
    expect(CritiqueBody.safeParse(body({ brief: briefForRequest(brief, doc, [f.id], 10) })).success).toBe(true);
  });

  it("rejects screenshots over the budget", () => {
    const big = "A".repeat(Math.ceil(IMAGE_BUDGET / 2) + 10);
    const screens = [0, 1].map((i) => ({ id: `s${i}`, name: "S", outline: "", image: big }));
    const r = CritiqueBody.safeParse(body({ screens }));
    expect(r.success).toBe(false);
  });

  it("orders images, then the cached outline, then the brief and transcript", () => {
    const blocks = buildCritiqueContent(body(), { cache: true });
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text", "text"]);
    expect(blocks[2]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect((blocks[2] as { text: string }).text).toContain("contrast");
    expect((blocks[3] as { text: string }).text).toContain("first turn");
    expect(buildCritiqueContent(body(), { cache: false })[2]).not.toHaveProperty("cache_control");
  });

  it("forces a verdict once the question budget is spent", () => {
    const transcript = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ topic: "goal" as const, question: `Q${i}`, answer: i % 2 ? null : "yes" }));
    const last = buildCritiqueContent(body({ transcript }), { cache: false }).at(-1) as { text: string };
    expect(last.text).toContain("mustConclude: true");
    expect(last.text).toContain("(skipped)");
  });

  it("tells follow-up turns what was already reported", () => {
    const last = buildCritiqueContent(body({ reported: ["[visual-hierarchy] ETA is buried"] }), { cache: false }).at(-1) as { text: string };
    expect(last.text).toContain("don't repeat");
    expect(last.text).toContain("ETA is buried");
  });

  it("recorded sample ends with a verdict and no question", () => {
    expect(SAMPLE_CRITIQUE_TURNS.at(-1)!.question).toBeNull();
    expect(SAMPLE_CRITIQUE_TURNS.slice(0, -1).every((t) => t.question && t.question.options.length <= 4)).toBe(true);
  });
});
