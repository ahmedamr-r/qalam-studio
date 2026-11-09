import { describe, expect, it } from "vitest";
import type { Ingested } from "@/discovery/ingest/core";
import { handoffOf } from "./handoff";

const ing = (raw: unknown): Ingested | null => {
  const i = raw as Ingested | null;
  return i && typeof i.text === "string" && i.text.trim() ? i : null;
};
const DOC = { from: "computer", title: "notes.pdf", voice: "customers", ingested: { kind: "pdf", title: "notes", text: "Sara: late again" } };
const IMG = { asset: "0123456789abcdef01234567", title: "IMG_1.png", type: "image/png" };

describe("what the start page hands its canvas", () => {
  it("keeps turns, whose it is, docs and pictures as they should be", () => {
    const h = handoffOf({ v: 1, turns: [{ mode: "take", said: "My notes" }, { mode: "scan", said: "Our app is Basket", target: { kind: "product", name: "Basket", mine: true } }], whose: { shape: "team", mine: true, sure: true, ask: "nope" }, docs: [DOC], images: [IMG] }, ing);
    expect(h).toEqual({ v: 1, turns: [{ mode: "take", said: "My notes" }, { mode: "scan", said: "Our app is Basket", target: { kind: "product", name: "Basket", mine: true } }], whose: { shape: "team", mine: true, sure: true }, docs: [{ from: "computer", title: "notes.pdf", voice: "customers", ingested: DOC.ingested }], images: [IMG] });
  });

  it("turns away anything it can't trust whole", () => {
    expect(handoffOf({ v: 2, turns: [{ mode: "scan", said: "x" }] }, ing)).toBeNull();
    expect(handoffOf({ v: 1, turns: [] }, ing)).toBeNull();
    expect(handoffOf({ v: 1, turns: [{ mode: "scan", said: "Basket", target: { kind: "nope" } }] }, ing)).toBeNull();
    expect(handoffOf({ v: 1, turns: [{ mode: "take", said: "" }], docs: [{ ...DOC, ingested: { kind: "pdf", title: "x", text: "" } }] }, ing)).toBeNull();
    expect(handoffOf({ v: 1, turns: [{ mode: "take", said: "" }], images: [{ ...IMG, asset: "../../etc" }] }, ing)).toBeNull();
    expect(handoffOf({ v: 1, turns: [{ mode: "take", said: "" }], images: [{ ...IMG, type: "image/svg+xml" }] }, ing)).toBeNull();
  });

  it("says unsure when whose it is came in as nothing", () => {
    expect(handoffOf({ v: 1, turns: [{ mode: "dump", said: "a lot of thinking" }] }, ing)?.whose).toEqual({ shape: "solo", mine: false, sure: false });
  });

  it("carries a consultant's turn with who's asking, kept to its lists and their words", () => {
    const said = "I want to work on a problem on my basket page in my delivery app";
    const h = handoffOf({ v: 1, turns: [{ mode: "consult", said, offer: true, situation: { named: true, product: "Talabat", name: "Delivery app", role: "owns it", level: "new", stage: "running", theirs: "yes", whose: "team", layer: "page", position: "founder" } }], whose: { shape: "team", mine: true, sure: true }, docs: [], images: [] }, ing);
    const t = h?.turns[0];
    expect(t?.mode).toBe("consult");
    if (t?.mode !== "consult") return;
    expect(t.offer).toBe(true);
    // A product's name they never wrote, and a role that shares nothing with their words, don't come along.
    expect(t.situation).toMatchObject({ product: "", name: "Delivery app", role: "", level: "new", stage: "running", theirs: "yes", whose: "team", layer: "page" });
    expect(t.situation?.position).toBeUndefined();
    expect(handoffOf({ v: 1, turns: [{ mode: "consult", said }], whose: {}, docs: [], images: [] }, ing)?.turns[0]).toEqual({ mode: "consult", said });
  });
});
