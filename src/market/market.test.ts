import { describe, expect, it } from "vitest";
import { marketPieces } from "@/hub/pieces";
import { aboutFromFacts, companyMaterial, sanitizeFacts, siteUrl } from "./facts";
import { marketFromMarkdown, marketToMarkdown } from "./market-md";
import { sessionOf } from "./session";
import { emptyMarket, type Market } from "./types";

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
