import { describe, expect, it } from "vitest";
import { businessFromMarkdown, businessToMarkdown } from "./business-md";
import { businessEditOf, editBusiness, lineText, noteLines, type BusinessNote } from "./edit";
import { businessText } from "./text";
import { BUSINESS_LIMITS, emptyBusiness, type Business } from "./types";

let n = 0;
const o = { now: 1000, id: () => `b${++n}` };
const from = [{ flow: "consult", key: "turn1", q: "q2" }];
const earns: BusinessNote = { section: "earns", text: "A cut from each shop and the delivery fee", by: "said", from };

const page = (): Business => {
  const a = editBusiness(emptyBusiness(), { op: "add", section: "serves", text: "Families ordering their weekly shop" }, o);
  return noteLines(a, [earns, { section: "numbers", text: "About 300 orders a day", by: "qalam", from }], o).business;
};

describe("business.md", () => {
  it("reads back what it writes, records and all, with every section's heading", () => {
    const b = page();
    const md = businessToMarkdown(b, { org: "Talabeya" });
    expect(md).toContain("# How Talabeya works");
    for (const h of ["## Who it serves", "## What they get", "## How it earns", "## What it takes to run", "## How customers find it", "## The numbers that matter", "## Where it stands"]) expect(md).toContain(h);
    expect(md).toContain("- A cut from each shop and the delivery fee <!-- qalam ");
    expect(businessFromMarkdown(md)).toEqual(b);
  });

  it("makes a line a person's once they change its words in the file", () => {
    const md = businessToMarkdown(page(), { org: "X" }).replace("About 300 orders a day", "About 280 orders a day");
    const line = businessFromMarkdown(md).lines.find((l) => l.section === "numbers");
    expect(line).toMatchObject({ text: "About 280 orders a day", by: "you" });
  });

  it("reads a line written by hand, bullet or not, as the person's, under its section", () => {
    const b = businessFromMarkdown("## How it earns\n\n- Delivery fees\nWe also sell ads to shops.\n\n## Where it stands\n\n* Two years in, self-funded\n");
    expect(b.lines.map((l) => [l.section, l.text, l.by])).toEqual([
      ["earns", "Delivery fees", "you"],
      ["earns", "We also sell ads to shops.", "you"],
      ["stands", "Two years in, self-funded", "you"],
    ]);
  });

  it("keeps what's under a heading it doesn't know, and a person's line above the sections", () => {
    const md = `${businessToMarkdown(page(), { org: "X" })}\n## Why we started\n\nOur cousin ran a shop.\n`.replace("# How X works\n", "# How X works\n\nA note of ours.\n");
    const b = businessFromMarkdown(md);
    expect(b.notes).toContain("## Why we started");
    expect(b.notes).toContain("Our cousin ran a shop.");
    expect(b.notes).toContain("A note of ours.");
    expect(businessFromMarkdown(businessToMarkdown(b, { org: "X" })).notes).toBe(b.notes);
  });

  it("still reads a section under the heading it had before", () => {
    expect(businessFromMarkdown("## What it costs to run\n\n- Riders' pay\n").lines).toEqual([expect.objectContaining({ section: "costs", text: "Riders' pay" })]);
  });

  it("reads nothing from a file of another version, and loses nothing", () => {
    const b = businessFromMarkdown('---\nqalam: "business/9"\n---\n\n## How it earns\n\n- Fees\n');
    expect(b.lines).toEqual([]);
    expect(b.notes).toContain("- Fees");
  });

  it("keeps a record from closing its comment early", () => {
    const b = noteLines(emptyBusiness(), [{ section: "gets", text: "Groceries at the door", by: "said", from: [{ flow: "consult", key: "k-->", q: "q1" }] }], o).business;
    const md = businessToMarkdown(b, { org: "X" });
    expect(md.match(/-->/g)?.length).toBe(1);
    expect(businessFromMarkdown(md).lines[0]).toMatchObject({ text: "Groceries at the door", by: "said", from: [{ key: "k-->" }] });
  });
});

describe("changing how the business works", () => {
  it("adds, fixes and keeps a line as the person's, and refuses a fix onto another line's words", () => {
    const b = page();
    const reading = b.lines.find((l) => l.by === "qalam")!;
    const kept = editBusiness(b, { op: "keep", id: reading.id }, { ...o, now: 2000 });
    expect(kept.lines.find((l) => l.id === reading.id)).toMatchObject({ by: "you", at: 2000 });
    const said = b.lines.find((l) => l.section === "earns")!;
    const fixed = editBusiness(b, { op: "fix", id: said.id, text: "A 12% cut from each shop" }, o);
    expect(fixed.lines.find((l) => l.id === said.id)).toMatchObject({ text: "A 12% cut from each shop", by: "you" });
    const two = editBusiness(b, { op: "add", section: "earns", text: "Ads" }, o);
    expect(editBusiness(two, { op: "fix", id: said.id, text: "ads" }, o)).toBe(two);
  });

  it("remembers a line taken off, so it isn't noted again until a person adds it back", () => {
    const b = page();
    const said = b.lines.find((l) => l.section === "earns")!;
    const off = editBusiness(b, { op: "remove", id: said.id }, o);
    expect(off.gone).toContain("a cut from each shop and the delivery fee");
    expect(noteLines(off, [earns], o).added).toEqual([]);
    const back = editBusiness(off, { op: "add", section: "earns", text: earns.text }, o);
    expect(back.gone).not.toContain("a cut from each shop and the delivery fee");
  });

  it("checks an edit as a request sends it", () => {
    expect(businessEditOf({ op: "add", section: "earns", text: "Fees" })).toEqual({ op: "add", section: "earns", text: "Fees" });
    expect(businessEditOf({ op: "add", section: "money", text: "Fees" })).toBeNull();
    expect(businessEditOf({ op: "fix", id: "b1" })).toBeNull();
    expect(businessEditOf({ op: "keep", id: "b1" })).toEqual({ op: "keep", id: "b1" });
    expect(businessEditOf({ op: "remove" })).toBeNull();
  });
});

describe("noting from a conversation", () => {
  it("never notes the same thing twice, and their words take the place of a reading of the same thing", () => {
    const b = noteLines(emptyBusiness(), [{ section: "earns", text: "Commission from shops and a delivery fee", by: "qalam", from }], o).business;
    const again = noteLines(b, [{ section: "earns", text: "commission from shops and a delivery fee", by: "qalam", from }], o);
    expect(again.added).toEqual([]);
    const theirs = noteLines(b, [{ section: "earns", text: "Commission from the shops and a delivery fee", by: "said", from }], o);
    expect(theirs.business.lines).toHaveLength(1);
    expect(theirs.business.lines[0]).toMatchObject({ by: "said", text: "Commission from the shops and a delivery fee", id: b.lines[0].id });
  });

  it("never rewrites a person's line, and a full section takes no more", () => {
    const mine = editBusiness(emptyBusiness(), { op: "add", section: "earns", text: "Commission from shops and a delivery fee" }, o);
    const r = noteLines(mine, [{ section: "earns", text: "Commission from the shops and a delivery fee", by: "said", from }], o);
    expect(r.added).toEqual([]);
    expect(r.business).toBe(mine);
    let full = emptyBusiness();
    for (let i = 0; i < BUSINESS_LIMITS.perSection; i++) full = editBusiness(full, { op: "add", section: "costs", text: `Cost number ${"abcdefgh"[i]} of running it` }, o);
    expect(noteLines(full, [{ section: "costs", text: "Riders' pay", by: "said", from }], o).added).toEqual([]);
  });

  it("cuts a long note at a word", () => {
    const long = "word ".repeat(80);
    const t = lineText(long);
    expect(t.length).toBeLessThanOrEqual(BUSINESS_LIMITS.text + 1);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("what calls hear", () => {
  it("says each line under its section, marks a reading as Qalam AI's, and fits its budget", () => {
    const text = businessText(page(), { org: "Talabeya" });
    expect(text).toContain("How Talabeya works, as the team tells it");
    expect(text).toContain("- How it earns: A cut from each shop and the delivery fee");
    expect(text).toContain("- The numbers that matter: About 300 orders a day (Qalam AI's reading of their answers, not their words)");
    expect(businessText(page(), { max: 120 }).split("\n").length).toBeLessThan(4);
    expect(businessText(emptyBusiness())).toBe("");
  });

  it("tells a web search only what the business is, never its costs, numbers or figures, nor a reading", () => {
    let b = page();
    b = editBusiness(b, { op: "add", section: "costs", text: "Riders are most of what it costs" }, o);
    b = editBusiness(b, { op: "add", section: "earns", text: "A 12% cut" }, o);
    const text = businessText(b, { research: true });
    expect(text).toContain("Who it serves: Families ordering their weekly shop");
    expect(text).toContain("How it earns: A cut from each shop and the delivery fee");
    expect(text).not.toMatch(/Riders|12%|300 orders/);
  });
});
