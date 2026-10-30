import { describe, expect, it } from "vitest";
import type { SourceQuote, SourceRecord } from "@/discovery/sources";
import { personFromMarkdown, personToMarkdown } from "@/org/people-md";
import { personOf, personShape, tally, tallyText, voiceOf, voicesByQuote, whoShape, type Person } from "./people";

const sara: Person = { id: "pSara", name: "Sara", segments: ["Parents"], role: "Mother of two" };
const omar: Person = { id: "pOmar", name: "Omar", segments: ["Offices", "Clinics"] };
const people = new Map([sara, omar].map((p) => [p.id, p]));
const at = Date.UTC(2026, 9, 1);

const quote = (id: string, extra: Partial<SourceQuote> = {}): SourceQuote => ({ id, text: "words", span: [0, 5], kind: "pain", addedBy: "ai", at, ...extra });
const source = (id: string, who?: SourceRecord["who"], quotes: SourceQuote[] = [], kind: SourceRecord["kind"] = "interview") =>
  ({ v: 1, id, projectId: "b1", kind, title: id, text: "words", addedAt: at, read: [], quotes, needs: [], ...(who ? { who } : {}) }) as SourceRecord;

describe("who said a quote", () => {
  it("is the person a source maps its speaker to, by id or by the name its quotes give", () => {
    const s = source("s1", { speakers: { S2: "pSara", omar: "pOmar" } });
    expect(personOf(s, { speakerId: "S2" }, people)).toBe(sara);
    expect(personOf(s, { speaker: "Omar" }, people)).toBe(omar);
    expect(personOf(s, { speakerId: "S3" }, people)).toBeUndefined();
  });

  it("is the source's one person when it has one, whatever the source calls them", () => {
    expect(personOf(source("s1", { person: "pSara" }), {}, people)).toBe(sara);
    expect(personOf(source("s1", { person: "pSara" }), { speaker: "Customer" }, people)).toBe(sara);
    // A source that maps its speakers doesn't hand an unmapped one to its person.
    expect(personOf(source("s1", { person: "pSara", speakers: { S2: "pOmar" } }), { speakerId: "S3" }, people)).toBeUndefined();
    expect(personOf(source("s1", { person: "gone" }), {}, people)).toBeUndefined();
  });

  it("is an unnamed voice of its source otherwise, in the source's segment", () => {
    const v = voiceOf(source("s1", { segment: "Offices", saidAt: at - 5 }), { speaker: "Ali" }, people);
    expect(v).toEqual({ key: "source:s1:ali", name: "Ali", segments: ["Offices"], source: "s1", at: at - 5 });
    expect(voiceOf(source("s2"), {}, people)).toEqual({ key: "source:s2", segments: [], source: "s2", at });
    // A person's own segments come first; the source's only when they have none.
    expect(voiceOf(source("s3", { person: "pSara", segment: "Offices" }), {}, people).segments).toEqual(["Parents"]);
  });
});

describe("counting voices", () => {
  it("counts each person once, unnamed voices once per source, and segments by voices", () => {
    const sources = [
      source("s1", { person: "pSara" }, [quote("q1"), quote("q2"), quote("q3")]),
      source("s2", { speakers: { S1: "pSara", S2: "pOmar" } }, [quote("q4", { speakerId: "S1" }), quote("q5", { speakerId: "S2" })]),
      source("s3", { segment: "parents" }, [quote("q6"), quote("q7")]),
      source("d1", undefined, [quote("q8")], "dump"),
    ];
    const byQuote = voicesByQuote(sources, [sara, omar]);
    expect(byQuote.has("hub:quote:q8")).toBe(false);
    const t = tally([...byQuote.values()]);
    expect(t).toEqual({ voices: 3, people: 2, segments: [["Parents", 2], ["Clinics", 1], ["Offices", 1]], sources: 3, newest: at });
    expect(tallyText(t)).toBe("3 voices (2 named) in 3 segments (3 sources)");
    expect(tallyText(tally([byQuote.get("hub:quote:q1")!]))).toBe("1 person in 1 segment (1 source)");
    expect(tallyText(tally([]))).toBe("");
  });
});

describe("what a window sends", () => {
  it("keeps a source's who as it should be", () => {
    expect(whoShape({ person: "pSara", speakers: { S1: "pOmar", S2: "../x" }, segment: "  Offices ", saidAt: at, extra: 1 })).toEqual({ person: "pSara", speakers: { S1: "pOmar" }, segment: "Offices", saidAt: at });
    expect(whoShape({ person: "pX" }, (id) => people.has(id))).toBeUndefined();
    expect(whoShape(null)).toBeUndefined();
  });

  it("keeps a person as it should be", () => {
    expect(personShape({ id: "pSara", name: "  Sara  A ", segments: ["Parents", "Parents", " ", 3], role: "", notes: " Two kids. " }, "pSara")).toEqual({ id: "pSara", name: "Sara A", segments: ["Parents"], notes: "Two kids." });
    expect(personShape({ id: "pSara", name: "" }, "pSara")).toBeNull();
    expect(personShape({ id: "other", name: "Sara" }, "pSara")).toBeNull();
  });
});

describe("people files", () => {
  it("are readable Markdown, read back", () => {
    const p = { ...sara, notes: "Orders every Sunday evening." };
    const md = personToMarkdown(p);
    expect(md).toBe('---\nid: "pSara"\nname: "Sara"\nsegments: ["Parents"]\nrole: "Mother of two"\n---\n\nOrders every Sunday evening.\n');
    expect(personFromMarkdown(md)).toEqual(p);
    expect(personFromMarkdown("---\nid: pX\nname: Ali\nsegments: Offices\n---\n")).toEqual({ id: "pX", name: "Ali", segments: ["Offices"] });
    expect(personFromMarkdown("# Ali\n")).toBeNull();
  });
});
