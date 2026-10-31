import { describe, expect, it } from "vitest";
import type { SourceQuote, SourceRecord } from "@/discovery/sources";
import { kindOfDoc, setupQuotes, splitIds, splitSetup } from "./setup-split";
import type { SetupDoc } from "./setup";

const said = "North Star: completed trips per week. Pickup is the worst part.";
const interviews = 'Mariam, 29:\n"The driver went to the wrong gate"\n"I cancel when the car is 12 minutes away"';
const plan = "Our plan: pin gates in compounds.";
const tickets = "Ahmed S.: Riders put the pin in the middle of the compound";
const text = `${said}\n\nFrom this computer: interviews.md (customers' words)\n\n${interviews}\n\nFrom this computer: plan.md\n\n${plan}\n\nFrom Intercom: Tickets (customers' words)\n\n${tickets}`;
const spanOf = (part: string): [number, number] => [text.indexOf(part), text.indexOf(part) + part.length];

let n = 0;
const quote = (words: string, role: SourceQuote["role"] = "evidence"): SourceQuote => {
  const i = text.indexOf(words);
  return { id: `q${++n}`, text: words, span: [i, i + words.length], kind: "pain", role, addedBy: "ai", at: 1 };
};

function dump(voices: Partial<Record<string, SetupDoc["voice"]>> = { interviews: "customers", tickets: "customers" }): SourceRecord {
  n = 0;
  const docs: SetupDoc[] = [
    { from: "said", title: "Your words", span: spanOf(said) },
    { from: "computer", title: "interviews.md", type: "markdown", span: spanOf(interviews), ...(voices.interviews ? { voice: voices.interviews } : {}) },
    { from: "computer", title: "plan.md", type: "markdown", span: spanOf(plan), voice: "own" },
    { from: "intercom", title: "Tickets", origin: "https://app.intercom.com/x", span: spanOf(tickets), ...(voices.tickets ? { voice: voices.tickets } : {}) },
  ];
  return {
    v: 1,
    id: "dump",
    projectId: "",
    boards: [],
    product: null,
    kind: "dump",
    title: "About Uber",
    text,
    addedAt: 5,
    read: [],
    quotes: [quote("North Star: completed trips per week.", "metric"), quote("The driver went to the wrong gate"), quote("I cancel when the car is 12 minutes away"), quote("pin gates in compounds", "idea"), quote("Riders put the pin in the middle of the compound")],
    needs: [],
    filed: [],
    setup: { v: 1, phase: "done", docs, understanding: "", challenges: [], buckets: [] },
  };
}

let ids = 0;
const newId = () => `s${++ids}`;

describe("splitSetup", () => {
  it("makes each customers' doc a source of its own, its quotes' ids and words kept", () => {
    ids = 0;
    const { dump: d, made } = splitSetup(dump(), newId);
    expect(made.map((s) => [s.id, s.kind, s.title])).toEqual([
      ["s1", "markdown", "interviews.md"],
      ["s2", "connector", "Tickets"],
    ]);
    for (const s of made) for (const q of s.quotes) expect(s.text.slice(q.span[0], q.span[1])).toBe(q.text);
    expect(made[0].quotes.map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(made[1].origin).toBe("https://app.intercom.com/x");
    // The dump keeps the person's own words, and says where each doc went.
    expect(d.quotes.map((q) => q.id)).toEqual(["q1", "q4"]);
    expect(splitIds(d)).toEqual(["s1", "s2"]);
    expect(d.text).toBe(text);
  });

  it("leaves a customers' doc's heading or number in the dump: only what they said moves", () => {
    ids = 0;
    const d = dump();
    const at = text.indexOf("Mariam, 29:");
    d.quotes.push({ id: "head", text: "Mariam, 29:", span: [at, at + 11], kind: "need", role: "context", addedBy: "ai", at: 1 });
    const { dump: after, made } = splitSetup(d, newId);
    expect(made[0].quotes.map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(after.quotes.map((q) => q.id)).toContain("head");
  });

  it("names who said it where the text does", () => {
    ids = 0;
    const { made } = splitSetup(dump(), newId);
    expect(made[0].quotes.map((q) => q.speaker)).toEqual(["Mariam", "Mariam"]);
    expect(made[1].quotes[0].speaker).toBe("Ahmed S.");
  });

  it("marks a split source read, so nothing reads it again unasked", () => {
    ids = 0;
    const { made } = splitSetup(dump(), newId);
    expect(made[0].read).toEqual([0]);
  });

  it("leaves the person's own docs, and a session with no voices, as they are", () => {
    ids = 0;
    const none = dump({});
    expect(splitSetup(none, newId)).toEqual({ dump: none, made: [] });
    const { made } = splitSetup(dump({ interviews: "own", tickets: "customers" }), newId);
    expect(made.map((s) => s.title)).toEqual(["Tickets"]);
  });

  it("changes nothing when run again", () => {
    ids = 0;
    const once = splitSetup(dump(), newId);
    expect(splitSetup(once.dump, newId)).toEqual({ dump: once.dump, made: [] });
  });
});

describe("setupQuotes", () => {
  it("sees every quote in the dump's text again, and where each lives now", () => {
    ids = 0;
    const before = dump();
    const { dump: d, made } = splitSetup(before, newId);
    const { quotes, homeOf } = setupQuotes(d, made);
    expect(quotes.map((q) => [q.id, q.span])).toEqual(before.quotes.map((q) => [q.id, q.span]));
    expect(homeOf("q2")?.source.id).toBe("s1");
    expect(homeOf("q2")?.quote.span).toEqual([interviews.indexOf("The driver"), interviews.indexOf("The driver") + "The driver went to the wrong gate".length]);
    expect(homeOf("q1")?.source.id).toBe("dump");
    expect(homeOf("nope")).toBeNull();
  });

  it("is the dump's own quotes before a split", () => {
    const d = dump();
    expect(setupQuotes(d, []).quotes).toEqual(d.quotes);
  });
});

describe("kindOfDoc", () => {
  it("reads a doc's kind from where it came and what it was read as", () => {
    expect(kindOfDoc({ from: "computer", type: "pdf" })).toBe("pdf");
    expect(kindOfDoc({ from: "computer", type: "sheet" })).toBe("text");
    expect(kindOfDoc({ from: "notion" })).toBe("connector");
    expect(kindOfDoc({ from: "page" })).toBe("url");
  });
});
