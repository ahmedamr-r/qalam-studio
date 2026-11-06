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
});
