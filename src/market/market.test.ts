import { describe, expect, it } from "vitest";
import { solutionsMaterial } from "@/discovery/solutions";
import { testsMaterial } from "@/discovery/tests";
import { problemsMaterial } from "@/goals/drafted";
import { marketPieces } from "@/hub/pieces";
import { editMarket } from "./edit";
import { aboutAfterFact, aboutFromFacts, companyMaterial, sanitizeFacts, siteUrl } from "./facts";
import { marketFromMarkdown, marketToMarkdown } from "./market-md";
import { competitorsMaterial, domainMaterial, sanitizeCompetitors, sanitizeDomain } from "./rivals";
import { sessionOf } from "./session";
import { marketContext } from "./text";
import { emptyMarket, MARKET_LIMITS, type Market, type MarketLine } from "./types";

const page = { ref: "", url: "https://tagaddod.com/about", title: "About Tagaddod", text: "Tagaddod collects used cooking oil from more than 50,000 households in Cairo and Giza and turns it into biodiesel. Households earn points for every litre." };

const market = (): Market => ({
  company: [
    { id: "f1", text: "Collects used cooking oil from homes in Cairo and Giza.", field: "does", url: page.url, title: page.title, quote: "Tagaddod collects used cooking oil", by: "qalam", at: 1 },
    { id: "f2", text: "Pays households in points for each litre.", field: "model", by: "you", at: 2 },
  ],
  competitors: [{ id: "c1", name: "Oilio", url: "https://oilio.example", lines: [{ id: "c1a", text: "Buys used oil from restaurants in Alexandria.", url: "https://oilio.example", by: "qalam", at: 1 }], by: "qalam", at: 1 }],
  aims: [{ id: "d1", text: "Collection companies watch litres collected per household per month.", url: "https://report.example", by: "qalam", at: 1 }],
  struggles: [{ id: "d2", text: "Households don't know when the next pickup is.", url: "https://forum.example", by: "qalam", at: 1 }],
  gone: ["recycle co"],
});

describe("hub/market.md", () => {
  it("reads back what it writes: each line with its page, competitors with theirs, the domain, and what they took off", () => {
    const m = market();
    const md = marketToMarkdown(m, { org: "Tagaddod" });
    expect(md).toContain("## The company");
    expect(md).toContain("- Collects used cooking oil from homes in Cairo and Giza. ([About Tagaddod](https://tagaddod.com/about))");
    expect(md).toContain("### Oilio ([oilio.example](https://oilio.example))");
    expect(md).toContain("### What their customers struggle with");
    expect(marketFromMarkdown(md)).toEqual(m);
  });

  it("makes a line the person's once they change its words, or write one with no record", () => {
    const md = marketToMarkdown(market(), { org: "Tagaddod" }).replace("homes in Cairo and Giza", "homes and restaurants in Cairo").replace("## Competitors", "- Started in 2016.\n\n## Competitors");
    const back = marketFromMarkdown(md);
    expect(back.company[0]).toMatchObject({ text: "Collects used cooking oil from homes and restaurants in Cairo.", by: "you", url: page.url });
    expect(back.company[2]).toMatchObject({ text: "Started in 2016.", by: "you" });
    expect(marketFromMarkdown("")).toEqual(emptyMarket());
  });

  it("indexes each line as the organization's context, saying where it was read", () => {
    const b = marketPieces(market(), "Tagaddod");
    expect(b.pieces.map((p) => [p.sub, p.line])).toEqual([
      ["market", "About Tagaddod, read on the web"],
      ["market", "About Tagaddod, as the team says"],
      ["competitor", "A competitor of Tagaddod, read on the web"],
      ["domain", "What companies like Tagaddod aim for, read on the web"],
      ["domain", "What customers of companies like Tagaddod struggle with, read on the web"],
    ]);
    expect(b.pieces.every((p) => p.type === "context")).toBe(true);
  });
});

describe("the company's facts", () => {
  const m = companyMaterial({ org: "Tagaddod", site: "https://tagaddod.com", said: "We collect oil from homes and restaurants.", notes: "- Tagaddod collects used oil [About](https://tagaddod.com/about)", pages: [page] });
  const ids = (i: number) => `f${i + 1}`;

  it("keeps a fact only where its quote is on its page and its numbers are in the quote; their own line's are theirs", () => {
    const raw = {
      facts: [
        { text: "Collects used cooking oil from over 50,000 households in Cairo and Giza.", field: "does", quote: "collects used cooking oil from more than 50,000 households in Cairo and Giza", page: "w1" },
        { text: "Serves 80,000 households.", field: "for", quote: "collects used cooking oil from more than 50,000 households", page: "w1" },
        { text: "Operates in Alexandria.", field: "where", quote: "Tagaddod operates in Alexandria", page: "w1" },
        { text: "Collects from restaurants too.", field: "for", quote: "We collect oil from homes and restaurants.", page: "you" },
        { text: "Runs a mobile app.", field: "product", quote: "Tagaddod collects", page: "w9" },
        { text: "Collects used cooking oil from over 50,000 households in Cairo and Giza.", field: "does", quote: "more than 50,000 households", page: "w1" },
      ],
    };
    const dropped: string[] = [];
    const facts = sanitizeFacts(raw, m, { now: 5, id: ids }, (why) => dropped.push(why));
    expect(facts).toEqual([
      { id: "f1", text: "Collects used cooking oil from over 50,000 households in Cairo and Giza.", field: "does", by: "qalam", at: 5, url: page.url, title: "About Tagaddod", quote: "collects used cooking oil from more than 50,000 households in Cairo and Giza" },
      { id: "f2", text: "Collects from restaurants too.", field: "for", by: "you", at: 5 },
    ]);
    expect(dropped).toEqual(["a number that isn't in the quote", "its quote isn't on the page", "a page not read", "there twice"]);
  });

  it("fills only the About's empty fields from what's kept", () => {
    const facts = sanitizeFacts({ facts: [{ text: "Collects used cooking oil from homes", field: "does", quote: "Tagaddod collects used cooking oil", page: "w1" }, { text: "Households in Cairo", field: "for", quote: "households in Cairo", page: "w1" }] }, m, { now: 1, id: ids });
    expect(aboutFromFacts(facts, { audience: "", context: "" })).toEqual({ context: "Collects used cooking oil from homes.", audience: "Households in Cairo." });
    expect(aboutFromFacts(facts, { audience: "Restaurants", context: "We already wrote this." })).toEqual({});
  });

  it("takes a bare website as an address, and nothing that isn't one", () => {
    expect(siteUrl("tagaddod.com")).toBe("https://tagaddod.com/");
    expect(siteUrl("https://www.tagaddod.com/en")).toBe("https://www.tagaddod.com/en");
    expect(siteUrl("we collect oil")).toBeNull();
    expect(siteUrl("localhost")).toBeNull();
  });
});

describe("the first run's lookups", () => {
  it("says a look stopped when nothing runs it any more", () => {
    const s = sessionOf({ v: 1, company: { state: "looking", at: 1, steps: [], facts: [] } });
    expect(s.company).toMatchObject({ state: "failed" });
    expect(sessionOf({ v: 1, company: { state: "looking", at: 1, steps: [], facts: [] } }, () => true).company?.state).toBe("looking");
    expect(sessionOf(null)).toEqual({ v: 1 });
  });
});

describe("competitors and the domain", () => {
  const oilio = { ref: "", url: "https://oilio.example/", title: "Oilio", text: "Oilio buys used cooking oil from restaurants across Alexandria and pays 12 pounds a litre. ".repeat(3) };
  const report = { ref: "", url: "https://report.example/uco", title: "UCO collection in MENA", text: "Collectors track litres collected per household each month. Households say pickups are hard to schedule. Recycly also collects from homes in Cairo. ".repeat(2) };
  let n = 0;
  const id = () => `x${++n}`;

  it("keeps one they named under their name, and a found one only where its name is on a page and a line about it holds", () => {
    const m = competitorsMaterial({ org: "Tagaddod", facts: [], named: ["oilio"], notes: "", pages: [oilio, report] });
    const raw = {
      competitors: [
        { name: "Oilio", page: "w1", lines: [{ text: "Buys used oil from restaurants in Alexandria for 12 pounds a litre.", quote: "buys used cooking oil from restaurants across Alexandria and pays 12 pounds a litre", page: "w1" }] },
        { name: "Recycly", page: "none", lines: [{ text: "Collects from homes in Cairo.", quote: "Recycly also collects from homes in Cairo", page: "w2" }] },
        { name: "GreenFuel", page: "none", lines: [{ text: "Makes biodiesel.", quote: "makes biodiesel", page: "w2" }] },
        { name: "Tagaddod", page: "none", lines: [] },
        { name: "Recycly", page: "none", lines: [] },
      ],
    };
    const dropped: string[] = [];
    const out = sanitizeCompetitors(raw, m, { org: "Tagaddod", now: 1, id, gone: [] }, (why) => dropped.push(why));
    expect(out.map((c) => [c.name, c.by, c.url ?? null, c.lines.map((l) => l.text)])).toEqual([
      ["oilio", "you", "https://oilio.example/", ["Buys used oil from restaurants in Alexandria for 12 pounds a litre."]],
      ["Recycly", "qalam", "https://report.example/uco", ["Collects from homes in Cairo."]],
    ]);
    expect(dropped).toEqual(["its name isn't on a page read", "the company itself", "there twice"]);
    // One they took off before stays off.
    expect(sanitizeCompetitors(raw, m, { org: "Tagaddod", now: 1, id, gone: ["recycly"] }, () => {}).map((c) => c.name)).toEqual(["oilio"]);
  });

  it("keeps a named one the call left out, as theirs", () => {
    const m = competitorsMaterial({ org: "Tagaddod", facts: [], named: ["Oilio", "Zeit Co"], notes: "", pages: [oilio] });
    expect(sanitizeCompetitors({ competitors: [] }, m, { org: "Tagaddod", now: 1, id, gone: [] }).map((c) => [c.name, c.by])).toEqual([
      ["Oilio", "you"],
      ["Zeit Co", "you"],
    ]);
  });

  it("keeps what companies like it aim for and what their customers struggle with, each on its page", () => {
    const m = domainMaterial({ org: "Tagaddod", facts: [], notes: "", pages: [report] });
    const d = sanitizeDomain({ aims: [{ text: "Collectors watch litres collected per household each month.", quote: "Collectors track litres collected per household each month", page: "w1" }, { text: "They aim for 30% growth.", quote: "Collectors track litres", page: "w1" }], struggles: [{ text: "Households find pickups hard to schedule.", quote: "Households say pickups are hard to schedule", page: "w1" }] }, m, { now: 1, id });
    expect(d.aims.map((l) => l.text)).toEqual(["Collectors watch litres collected per household each month."]);
    expect(d.struggles).toMatchObject([{ text: "Households find pickups hard to schedule.", url: "https://report.example/uco", by: "qalam" }]);
  });
});

describe("what's known, as the canvas edits it and calls hear it", () => {
  const line = (id: string, text: string, o: Partial<MarketLine> = {}): MarketLine => ({ id, text, by: "qalam", at: 1, url: "https://x.com/", title: "X", quote: text, ...o });
  const known = (): Market => ({ ...emptyMarket(), company: [line("f1", "Collects used oil in Cairo")], competitors: [{ id: "c1", name: "Delta Oil", lines: [line("l1", "Sells recycled oil")], by: "qalam", at: 1 }], aims: [line("d1", "More repeat collections")] });
  const at = { now: 5, id: (p: string) => `${p}new` };

  it("a line fixed is theirs, with its link and without the page's words", () => {
    const m = editMarket(known(), { kind: "fix", id: "f1", text: "  Collects  used oil in Giza " }, at);
    expect(m.company[0]).toEqual({ id: "f1", text: "Collects used oil in Giza", url: "https://x.com/", title: "X", by: "you", at: 5 });
    const inRival = editMarket(known(), { kind: "fix", id: "l1", text: "Sells oil" }, at);
    expect(inRival.competitors[0].lines[0]).toMatchObject({ text: "Sells oil", by: "you" });
  });

  it("the same words, or no words, change nothing", () => {
    const m = known();
    expect(editMarket(m, { kind: "fix", id: "f1", text: "Collects used oil in Cairo" }, at)).toBe(m);
    expect(editMarket(m, { kind: "fix", id: "f1", text: "  " }, at)).toBe(m);
    expect(editMarket(m, { kind: "add", section: "aims", text: " " }, at)).toBe(m);
  });

  it("a competitor taken off is never proposed again, until they add it back", () => {
    const off = editMarket(known(), { kind: "remove", id: "c1" }, at);
    expect(off.competitors).toEqual([]);
    expect(off.gone).toEqual(["delta oil"]);
    const back = editMarket(off, { kind: "add", section: "competitors", text: "Delta Oil" }, at);
    expect(back.competitors[0]).toMatchObject({ id: "cnew", name: "Delta Oil", by: "you" });
    expect(back.gone).toEqual([]);
    expect(editMarket(back, { kind: "add", section: "competitors", text: "delta oil" }, at)).toBe(back);
  });

  it("adds each kind in their words, up to its limit", () => {
    const m = editMarket(known(), { kind: "add", section: "company", text: "Founded in 2013" }, at);
    expect(m.company[1]).toEqual({ id: "fnew", text: "Founded in 2013", field: "does", by: "you", at: 5 });
    const full = { ...emptyMarket(), aims: Array.from({ length: MARKET_LIMITS.domain }, (_, i) => line(`d${i}`, `Aim ${i}`)) };
    expect(editMarket(full, { kind: "add", section: "aims", text: "One more" }, at)).toBe(full);
  });

  it("the About loses or changes a fact's sentence only where it's still word for word", () => {
    const about = { audience: "", context: "Collects used oil in Cairo. Founded in 2013." };
    expect(aboutAfterFact(about, "Collects used oil in Cairo", null)).toEqual({ context: "Founded in 2013." });
    expect(aboutAfterFact(about, "Collects used oil in Cairo", "Collects oil in Giza")).toEqual({ context: "Collects oil in Giza. Founded in 2013." });
    expect(aboutAfterFact({ audience: "", context: "We rewrote this ourselves." }, "Collects used oil in Cairo", null)).toEqual({});
  });

  it("calls hear the facts the About doesn't hold, and the competitors", () => {
    const text = marketContext(known(), { org: "Tagaddod" });
    expect(text).toContain("- Collects used oil in Cairo");
    expect(text).toContain("Delta Oil (Sells recycled oil)");
    expect(text).toContain("never what its customers said");
    expect(marketContext(known(), { org: "Tagaddod", told: "Context: Collects used oil in Cairo." })).not.toContain("- Collects used oil");
    expect(marketContext(emptyMarket(), { org: "Tagaddod" })).toBe("");
  });

  it("what's known words a draft, and no number or quote can come from it", () => {
    const company = "Delta Oil has 40 branches";
    const solutions = solutionsMaterial({ problem: { title: "Late pickups", topic: null }, lines: [], pieces: [], goals: [], claims: [], steps: [], cards: [], ideas: [], company });
    expect(solutions.text).toContain(company);
    expect(solutions.hay).not.toContain("40 branches");
    const problems = problemsMaterial({ goal: { title: "More pickups", metric: null }, above: [], behind: [], pages: [], pieces: [], company });
    expect(problems.text).toContain(company);
    expect(problems.hay).not.toContain("40 branches");
    const tests = testsMaterial({ solution: { title: "Reminders", description: "", assumptions: [], tests: [] }, problem: null, goal: null, pieces: [], company });
    expect(tests.text).toContain(company);
    expect(tests.hay).not.toContain("40 branches");
  });
});
