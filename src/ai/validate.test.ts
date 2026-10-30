import { describe, expect, it } from "vitest";
import { toChatParts, needsVision, splitBlocks } from "./content";
import { extractSchema, synthesizeSchema, draftSchema, dumpReadSchema, dumpFollowupSchema, dumpPlaceSchema } from "./discovery";
import { bearingsSchema } from "./goals";
import { jobsSchema } from "./jobs";
import { claimsSchema } from "./outside";
import { breakdownSchema } from "./breakdown";
import { readerSchema } from "./code";
import { askSchema } from "./ask";
import { setupReadSchema, setupFollowupSchema, setupShapeSchema, setupPlaceSchema } from "./setup";
import { solutionsSchema } from "./solutions";
import { checkAnswer, jsonIn, repairPrompt, strictSchema, withoutNulls } from "./validate";

describe("an answer read for an engine that doesn't enforce the schema", () => {
  const schema = { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["need", "idea"] }, cites: { type: "array", items: { type: "string" } } }, required: ["kind", "cites"] };

  it("finds the JSON past a model's thinking, a code fence or words around it", () => {
    expect(jsonIn('<think>hmm {not this}</think>\n```json\n{"kind":"need","cites":[]}\n```')).toEqual({ kind: "need", cites: [] });
    expect(jsonIn('Here it is: {"kind":"idea","cites":["q1"]} hope that helps')).toEqual({ kind: "idea", cites: ["q1"] });
    expect(jsonIn("no json here")).toBeNull();
  });

  it("checks it against the call's schema, and says what's wrong in a few words for one repair turn", () => {
    expect(checkAnswer('{"kind":"need","cites":["q1"]}', schema)).toEqual({ ok: true, data: { kind: "need", cites: ["q1"] } });
    const bad = checkAnswer('{"kind":"wish","cites":[1]}', schema);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems).toEqual([expect.stringContaining("kind:"), expect.stringContaining("cites.0:")]);
    expect(checkAnswer("sorry", schema)).toEqual({ ok: false, problems: ["The answer wasn't a JSON object."] });
    expect(repairPrompt(["kind: wrong"])).toContain("- kind: wrong");
  });

  it("makes a schema strict (every field required, an optional one nullable) and takes the nulls back out", () => {
    const loose = { type: "object", properties: { kind: { type: "string", enum: ["need", "idea"] }, note: { type: "string" }, tags: { type: "array", items: { type: "object", properties: { id: { type: "string" }, why: { type: "string" } }, required: ["id"] } } }, required: ["kind"] };
    expect(strictSchema(loose)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["kind", "note", "tags"],
      properties: {
        kind: { type: "string", enum: ["need", "idea"] },
        note: { type: ["string", "null"] },
        tags: { type: ["array", "null"], items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: ["string", "null"] } } } },
      },
    });
    expect(strictSchema(loose)).toBe(strictSchema(loose));
    expect(checkAnswer('{"kind":"need","note":null,"tags":[{"id":"t1","why":null}]}', loose)).toEqual({ ok: true, data: { kind: "need", tags: [{ id: "t1" }] } });
    expect(withoutNulls({ kind: null }, loose)).toEqual({ kind: null });
  });

  it("can check every structured call's schema", () => {
    const ids = new Map([["x1", {}]]);
    const schemas: Record<string, unknown>[] = [
      extractSchema(["c1"]),
      synthesizeSchema(["n1"], ["o1"], ["q1"]),
      draftSchema(["a1"], ["k1"]),
      dumpReadSchema(["c1"]),
      dumpFollowupSchema(["c1"], ["f1"]),
      dumpPlaceSchema({ cards: ["c1"], holders: ["c1"], solutions: ["c1"], outcomes: ["c1"], fragments: ["f1"], answers: ["a1"], quotes: ["k1"] }),
      bearingsSchema({ problems: ids, targets: ["g1"], lines: ids } as never),
      jobsSchema({ gaps: ids, tools: ids, segments: ids, people: ids } as never),
      claimsSchema({ pages: ids } as never),
      breakdownSchema({ pieces: ids, benchmarks: ids } as never),
      readerSchema(["g1"]),
      askSchema({ topics: ["t1"] }),
      setupReadSchema(),
      setupFollowupSchema(["f1"]),
      setupShapeSchema({ goals: ["g1"], products: ["p1"] }),
      setupPlaceSchema({ fragments: ["f1"], answers: ["a1"], products: ["p1"] }),
      solutionsSchema({ ideas: ids } as never),
    ];
    for (const s of schemas) {
      expect(() => checkAnswer("{}", s as Record<string, unknown>)).not.toThrow();
      // Strict for OpenAI and Codex: every object lists all its fields as required and takes no others.
      const objects: Record<string, unknown>[] = [];
      const walk = (x: unknown) => {
        if (!x || typeof x !== "object") return;
        const o = x as Record<string, unknown>;
        if (o.properties) objects.push(o);
        Object.values(o).forEach(walk);
      };
      walk(strictSchema(s as Record<string, unknown>));
      for (const o of objects) {
        expect(o.additionalProperties).toBe(false);
        expect(o.required).toEqual(Object.keys(o.properties as object));
      }
    }
  });
});

describe("what a call sends, for other engines", () => {
  const blocks = [
    { type: "text", text: "Read these screens.", cache_control: { type: "ephemeral" } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
    { type: "text", text: "Then answer." },
  ];

  it("turns text and images into chat parts, a picture as a data address", () => {
    expect(toChatParts(blocks)).toEqual([
      { type: "text", text: "Read these screens." },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBOR" } },
      { type: "text", text: "Then answer." },
    ]);
    expect([needsVision(blocks), needsVision([{ type: "text", text: "x" }])]).toEqual([true, false]);
  });

  it("gives an agent its prompt as text, each picture named where it was", () => {
    expect(splitBlocks(blocks)).toEqual({ text: "Read these screens.\n\n[Image 1]\n\nThen answer.", images: [{ media: "image/png", data: "iVBOR" }] });
  });
});
