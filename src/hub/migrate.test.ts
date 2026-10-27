import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import { evidenceToLink, linkEvidenceIn } from "./migrate";

const source = { id: "s1", quotes: [{ id: "q1", text: "We waited 50 minutes", span: [10, 30] }] } as unknown as SourceRecord;
const doc = {
  roots: ["c1"],
  nodes: {
    c1: {
      id: "c1",
      meta: {
        ost: {
          kind: "opportunity",
          title: "Late deliveries",
          evidence: [
            { id: "e1", kind: "quote", text: "We waited 50 minutes", sourceId: "s1", span: [10, 30], addedBy: "ai", at: 1 },
            { id: "e2", kind: "quote", text: "gone", sourceId: "s1", span: [99, 120], addedBy: "ai", at: 1 },
            { id: "e3", kind: "answer", text: "an answer", answerId: "interview:pains", addedBy: "user", at: 1 },
            { id: "e4", kind: "quote", text: "already linked", sourceId: "s1", span: [10, 30], piece: "hub:quote:q1", addedBy: "ai", at: 1 },
          ],
        },
      },
    },
  },
} as unknown as Doc;

describe("linking evidence to its quote", () => {
  it("names the quote where the words still sit, and leaves the rest", () => {
    const links = evidenceToLink(doc, [source]);
    expect([...links]).toEqual([["e1", "hub:quote:q1"]]);
    const next = produce(doc, (d) => linkEvidenceIn(d, links));
    const ev = (next.nodes.c1 as unknown as { meta: { ost: { evidence: { id: string; piece?: string }[] } } }).meta.ost.evidence;
    expect(ev.map((e) => e.piece)).toEqual(["hub:quote:q1", undefined, undefined, "hub:quote:q1"]);
  });

  it("finds nothing to do on a board already linked, or without its sources", () => {
    expect(evidenceToLink(doc, []).size).toBe(0);
  });
});
