import { describe, expect, it } from "vitest";
import { topicFromMarkdown, topicToMarkdown } from "./topic-md";
import { applyFiling, checkWords, emptyFiling, isEvidence, sameTopic, sanitizeFiling, type Citable, type FilingSent, type Topic } from "./topics";

const AT = new Date(2026, 9, 27, 12).getTime();

const page = (over: Partial<Topic> = {}): Topic => ({
  id: "tp1",
  kind: "need",
  title: "I can't plan my day around the delivery window",
  products: ["grocery"],
  createdAt: AT,
  updatedAt: AT,
  lines: [
    { id: "l1", section: "know", text: "Parents plan bath time around the delivery, and a four-hour window breaks that.", by: "qalam", cites: ["hub:quote:sara-7"], from: ["Sara interview"], at: AT },
    { id: "l2", section: "believe", text: "Our ETAs are right most of the time.", by: "person", cites: [], from: [], at: 0 },
  ],
  history: [{ at: AT, text: "Qalam AI started this page from “Sara interview”, with 1 line." }],
  ...over,
});

describe("topic files", () => {
  it("reads back what it writes, and writes it the same again", () => {
    const t = page({
      lines: [
        ...page().lines,
        {
          id: "l3",
          section: "open",
          text: "Do offices need narrower windows too?",
          by: "qalam",
          cites: ["hub:quote:mona-4"],
          from: ["Mona interview"],
          at: AT,
          disputes: [{ id: "d1", text: "Mona says “Deliveries must arrive before 8” for her office.", by: "qalam", cites: ["hub:quote:mona-5"], from: ["Mona interview"], at: AT }],
        },
      ],
      intro: "Started from the reorder research.",
      notes: "## Links\n\n- [Research plan](../plan.md)",
      extra: { tags: ["delivery"] },
    });
    const md = topicToMarkdown(t);
    expect(md).toContain("# I can't plan my day around the delivery window");
    expect(md).toContain("## We know\n\n- Parents plan bath time around the delivery, and a four-hour window breaks that. *(Sara interview)* <!-- qalam ");
    expect(md).toContain("## We believe\n\n- Our ETAs are right most of the time.\n");
    expect(md).toContain("  - Disputed: Mona says");
    expect(md).toContain("- 2026-10-27 · Qalam AI started this page");
    expect(md).not.toContain("## Against");
    const back = topicFromMarkdown(md)!;
    expect(back).toEqual({ ...t, lines: t.lines.map((l) => (l.by === "person" ? { ...l, id: back.lines[1].id } : l)) });
    expect(topicToMarkdown(back)).toBe(md);
  });

  it("makes a line edited by hand the person's, and keeps what Qalam doesn't know", () => {
    const md = topicToMarkdown(page())
      .replace("a four-hour window breaks that.", "a four-hour window breaks their whole evening.")
      .replace("## We believe\n\n", "## We believe\n\nWhat the founders think.\n\n* A new belief, written by hand\n")
      .replace("## History", "## Our notes\n\nKeep this.\n\n## History");
    const t = topicFromMarkdown(md)!;
    expect(t.lines[0]).toMatchObject({ id: "l1", by: "person", text: "Parents plan bath time around the delivery, and a four-hour window breaks their whole evening.", cites: ["hub:quote:sara-7"] });
    expect(t.lines.map((l) => [l.section, l.by])).toEqual([
      ["know", "person"],
      ["believe", "person"],
      ["believe", "person"],
    ]);
    expect(t.intros?.believe).toBe("What the founders think.");
    expect(t.notes).toBe("## Our notes\n\nKeep this.");
    const again = topicToMarkdown(t);
    expect(again).toContain("## Our notes\n\nKeep this.");
    expect(again).toContain("What the founders think.\n\n- A new belief, written by hand");
  });

  it("reads a page written by hand, without Qalam's front matter", () => {
    const t = topicFromMarkdown("# Parents of young children\n\n## We know\n\n- They order on Sunday nights.\n  More detail here.\n", "hand-1")!;
    expect(t).toMatchObject({ id: "hand-1", kind: "need", title: "Parents of young children", products: [] });
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ by: "person", text: "They order on Sunday nights.", more: "  More detail here." });
    expect(topicFromMarkdown("# No id here\n")).toBeNull();
    expect(topicFromMarkdown('---\nqalam: "topic/9"\nid: "x"\n---\n# Later version\n')).toBeNull();
  });
});

describe("what code stands behind", () => {
  const sara = { text: "I can't plan bath time around a four-hour window." };
  const tickets = { text: "Late or missed delivery: 131 tickets. Most are evening slots that slipped past 10pm." };

  it("keeps quotes found word for word and numbers the pieces have", () => {
    expect(checkWords("Sara: “I can't plan bath time around a four-hour window” [q1].", [sara])).toBe("Sara: “I can't plan bath time around a four-hour window”.");
    expect(checkWords("Late deliveries led to 131 tickets in a week.", [tickets])).toBe("Late deliveries led to 131 tickets in a week.");
    expect(checkWords("Sara: “I can't plan my evenings around deliveries”.", [sara])).toBeNull();
    expect(checkWords("Late deliveries led to 200 tickets.", [tickets])).toBeNull();
    // Numbers against letters are checked too.
    expect(checkWords("Most late tickets slipped past 10pm.", [tickets])).toBe("Most late tickets slipped past 10pm.");
    expect(checkWords("Most late tickets slipped past 11pm.", [tickets])).toBeNull();
    expect(checkWords("They want 2 million dirhams a month.", [{ text: "they want 2M dirhams a month in orders" }])).toBe("They want 2 million dirhams a month.");
    expect(checkWords("Orders reached 1,200 a day.", [{ text: "We get 1200 orders a day" }])).toBe("Orders reached 1,200 a day.");
    expect(checkWords("Sara said “I can't plan bath time", [sara])).toBeNull();
    expect(checkWords("x".repeat(400), [sara])).toBeNull();
  });

  it("tells customers' words and results from the team's", () => {
    expect(isEvidence({ type: "quote", sub: "pain" })).toBe(true);
    expect(isEvidence({ type: "quote", sub: "dump:assumption" })).toBe(false);
    expect(isEvidence({ type: "evidence", sub: "quote" })).toBe(true);
    expect(isEvidence({ type: "evidence", sub: "answer" })).toBe(false);
    expect(isEvidence({ type: "card", sub: "test", stage: "passed" })).toBe(true);
    expect(isEvidence({ type: "card", sub: "test", stage: "running" })).toBe(false);
    expect(isEvidence({ type: "decision", sub: "drop" })).toBe(false);
  });

  it("knows two titles for the same topic", () => {
    expect(sameTopic("Delivery windows are too wide", "delivery windows are too wide.")).toBe(true);
    expect(sameTopic("Evening slots sell out", "Morning slots sell out")).toBe(false);
  });
});

describe("filing", () => {
  const cite = (ref: string, text: string, evidence = true, product: string | null = "grocery", label = "Sara interview"): Citable => ({ ref, text, label, evidence, product });
  const sent = (): FilingSent => ({
    topics: new Map([
      ["t1", { id: "tp1", kind: "need", title: "I can't plan my day around the delivery window", products: ["grocery"], lines: page().lines.map((l) => l.text) }],
      ["t2", { id: null, kind: "segment", title: "Parents of young children", products: ["grocery"], lines: [] }],
    ]),
    lines: new Map([
      ["l1", { topic: "t1", line: page().lines[0] }],
      ["l2", { topic: "t1", line: page().lines[1] }],
    ]),
    cites: new Map([
      ["q1", cite("hub:quote:sara-7", "I can't plan bath time around a four-hour window.")],
      ["q2", cite("hub:quote:tix-1", "Late or missed delivery: 131 tickets. Most are evening slots that slipped past 10pm.", true, "grocery", "Support tickets")],
      ["q3", cite("hub:quote:dump-5", "I'm not sure arrival time matters that much, our ETAs are right most of the time.", false, "grocery", "Founder notes")],
      ["k1", cite("hub:quote:mona-4", "We open at nine, so anything after half eight is useless to us.", true, "business", "Mona interview")],
    ]),
  });

  it("keeps lines that rest on what was sent, and starts the pages they need", () => {
    const f = sanitizeFiling(
      {
        newTopics: [
          { id: "n1", kind: "need", title: "Evening slots slip past 10pm", why: "" },
          { id: "n2", kind: "need", title: "I can't plan my day around the delivery window.", why: "same as t1" },
          { id: "n3", kind: "need", title: "Nothing kept for this one", why: "" },
        ],
        add: [
          { topic: "t1", section: "know", text: "Late or missed deliveries were the most common ticket, at 131.", cites: ["q2"] },
          { topic: "n1", section: "know", text: "Most late tickets are evening slots that “slipped past 10pm”.", cites: ["q2", "q9"] },
          { topic: "n2", section: "open", text: "Do offices need deliveries before opening?", cites: ["k1"] },
          { topic: "n3", section: "know", text: "Something with no pieces behind it.", cites: ["q7"] },
          { topic: "t2", section: "know", text: "Parents plan around bath time.", cites: ["q1"] },
          { topic: "t1", section: "know", text: "Arrival time may not matter much.", cites: ["q3"] },
          { topic: "t1", section: "know", text: "Customers said “deliveries are always late”.", cites: ["q2"] },
          { topic: "t1", section: "against", text: "Late tickets number 400.", cites: ["q2"] },
          { topic: "t1", section: "know", text: "Parents plan bath time around the delivery, and a four-hour window breaks that.", cites: ["q1"] },
        ],
        revise: [
          { line: "l1", text: "Parents plan bath time around the delivery, and a four-hour window breaks that.", cites: ["q1", "q2"] },
          { line: "l2", text: "Rewriting a person's line.", cites: ["q3"] },
        ],
        retire: [{ line: "l2", why: "" }],
        dispute: [{ line: "l2", text: "Support tickets show 131 late or missed deliveries in a week.", cites: ["q2"] }],
      },
      sent(),
      { products: ["grocery"] },
    );
    expect(f.add.map((a) => [a.topic, a.section, a.text])).toEqual([
      ["tp1", "know", "Late or missed deliveries were the most common ticket, at 131."],
      ["new:n1", "know", "Most late tickets are evening slots that “slipped past 10pm”."],
      ["tp1", "open", "Do offices need deliveries before opening?"],
      ["new:t2", "know", "Parents plan around bath time."],
      // The team's words alone: something it believes.
      ["tp1", "believe", "Arrival time may not matter much."],
    ]);
    expect(f.add[1]).toMatchObject({ cites: ["hub:quote:tix-1"], from: ["Support tickets"], products: ["grocery"] });
    expect(f.add[2].products).toEqual(["business"]);
    expect(f.create).toEqual([
      { key: "t2", kind: "segment", title: "Parents of young children", products: ["grocery"] },
      { key: "n1", kind: "need", title: "Evening slots slip past 10pm", products: ["grocery"] },
    ]);
    expect(f.revise.map((r) => r.line)).toEqual(["l1"]);
    expect(f.retire).toEqual([]);
    expect(f.dispute).toMatchObject([{ topic: "tp1", line: "l2", cites: ["hub:quote:tix-1"] }]);
  });

  it("lets a revision keep words its line already had", () => {
    const f = sanitizeFiling({ revise: [{ line: "l1", text: "Parents plan bath time around the delivery, and a four-hour window breaks that; offices too.", cites: ["k1"] }] }, sent());
    expect(f.revise).toHaveLength(1);
    expect(sanitizeFiling({}, sent())).toEqual(emptyFiling());
    expect(sanitizeFiling(null, sent())).toEqual(emptyFiling());
  });

  it("applies a filing to the pages as they are, with their history", () => {
    let n = 0;
    const newId = () => `x${++n}`;
    const pages = new Map([["tp1", page()]]);
    const r = applyFiling(
      pages,
      {
        create: [
          { key: "n1", kind: "need", title: "Evening slots slip past 10pm", products: ["grocery"] },
          { key: "n2", kind: "need", title: "Only a repeat", products: [] },
        ],
        add: [
          { topic: "tp1", section: "know", text: "Late or missed deliveries were the most common ticket.", cites: ["hub:quote:tix-1"], from: ["Support tickets"], products: ["grocery"] },
          { topic: "new:n1", section: "know", text: "Most late tickets are evening slots.", cites: ["hub:quote:tix-1"], from: ["Support tickets"], products: ["grocery"] },
          { topic: "tp1", section: "know", text: "parents plan bath time around the delivery, and a four-hour window breaks that", cites: ["hub:quote:sara-7"], from: ["Sara interview"], products: [] },
        ],
        revise: [{ topic: "tp1", line: "l1", text: page().lines[0].text, cites: ["hub:quote:tix-1"], from: ["Support tickets"], products: ["business"] }],
        retire: [],
        dispute: [{ topic: "tp1", line: "l2", text: "Support tickets show many late deliveries.", cites: ["hub:quote:tix-1"], from: ["Support tickets"], products: [] }],
      },
      { now: AT + 1000, newId, from: "“Support tickets”" },
    );
    expect(r.counts).toEqual({ added: 2, revised: 1, retired: 0, disputed: 1 });
    expect(r.created).toEqual(["x1"]);
    const tp1 = r.pages.find((p) => p.id === "tp1")!;
    expect(tp1.lines).toHaveLength(3);
    expect(tp1.lines[0]).toMatchObject({ cites: ["hub:quote:sara-7", "hub:quote:tix-1"], from: ["Sara interview", "Support tickets"] });
    expect(tp1.lines[1].disputes).toMatchObject([{ text: "Support tickets show many late deliveries.", by: "qalam" }]);
    expect(tp1.products).toEqual(["grocery", "business"]);
    expect(tp1.history[0].text).toBe("Qalam AI added 1 line, revised 1 and disputed 1, from “Support tickets”.");
    expect(r.pages.find((p) => p.id === "x1")?.history[0].text).toBe("Qalam AI started this page from “Support tickets”, with 1 line.");
    // The page as it was isn't changed.
    expect(pages.get("tp1")!.lines).toHaveLength(2);

    const back = applyFiling(new Map([["tp1", tp1]]), { ...emptyFiling(), retire: [{ topic: "tp1", line: "l2", why: "" }, { topic: "tp1", line: tp1.lines[2].id, why: "superseded by newer tickets" }] }, { now: AT + 2000, newId, from: "“x”" });
    expect(back.counts.retired).toBe(1);
    expect(back.pages[0].lines.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(back.pages[0].history[0].text).toBe("Qalam AI took back “Late or missed deliveries were the most common ticket”: superseded by newer tickets.");
  });
});
