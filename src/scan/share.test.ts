import { describe, expect, it } from "vitest";
import { cardQuotes, fromLabel, readLine, reportHtml, shortQuote, type ReportData } from "./share";

describe("a quote on a card", () => {
  it("says where it came from as a place, never a person", () => {
    expect(fromLabel("App Store reviews: HoneyBook - Small Business CRM")).toBe("App Store review of HoneyBook");
    expect(fromLabel("Hacker News: My clients keep ghosting invoices", "https://news.ycombinator.com/item?id=1")).toBe("Hacker News");
    expect(fromLabel("What to do about late payment?? at DVinfo.net", "https://www.dvinfo.net/forum/1")).toBe("dvinfo.net");
    expect(fromLabel("A page with no address")).toBe("A page with no address");
  });

  it("keeps a short one whole, a long one to its first sentences, and says when it had to cut", () => {
    expect(shortQuote("She paid the deposit, then ghosted me.")).toBe("She paid the deposit, then ghosted me.");
    const two = `She paid the deposit, then ghosted me for three whole months. ${"After that I sent email after email and never heard back from them at all, ".repeat(3)}`;
    expect(shortQuote(two)).toBe("She paid the deposit, then ghosted me for three whole months.");
    const none = "word ".repeat(60);
    const cut = shortQuote(none)!;
    expect(cut.endsWith("…")).toBe(true);
    expect(none).toContain(cut.slice(0, -1));
    expect(cut.length).toBeLessThanOrEqual(151);
    expect(shortQuote(`Short. ${"x".repeat(300)}`)).toBeNull();
  });

  it("only ever shows words as they stand in the quote", () => {
    const text = `Chasing is awful. ${"I send one reminder after another and they all get ignored by the couple, ".repeat(4)}`;
    const q = shortQuote(text)!.replace(/…$/, "");
    expect(text.replace(/\s+/g, " ")).toContain(q);
  });

  it("takes one from each place first, whole ones before cut ones", () => {
    const q = (text: string, source: string, url: string) => ({ text, source, url });
    const long = "word ".repeat(60);
    const picked = cardQuotes([q(long, "A forum", "https://a.example/1"), q("One from the forum, short and whole.", "A forum", "https://a.example/2"), q("Another from the forum, short and whole.", "A forum", "https://a.example/3"), q("One from a review, short and whole.", "App Store reviews: Studio", "https://apps.apple.com/app/id1"), q("One from a thread, short and whole.", "Hacker News: x", "https://news.ycombinator.com/item?id=1")]);
    expect(picked.map((p) => p.from)).toEqual(["a.example", "App Store review of Studio", "Hacker News"]);
    expect(picked.every((p) => !p.text.endsWith("…"))).toBe(true);
    expect(picked).toHaveLength(3);
  });

  it("fills up from the same place when there's only one, and says how much was read", () => {
    const q = (text: string) => ({ text, source: "A forum", url: "https://a.example/1" });
    expect(cardQuotes([q("First short and whole quote here."), q("Second short and whole quote here.")])).toHaveLength(2);
    expect(readLine(84, 7)).toBe("84 quotes from 7 places");
    expect(readLine(1, 1)).toBe("1 quote from 1 place");
  });
});

describe("the report", () => {
  const data = (o: Partial<ReportData> = {}): ReportData => ({
    about: "A tool that helps wedding photographers get paid on time",
    at: Date.UTC(2026, 10, 3),
    quotes: 84,
    places: 7,
    problems: [{ id: "t1", title: "Couples don't pay the balance", line: "43 quotes from people online · 5 sources", quotes: [{ text: "She ghosted me.", source: "A forum", url: "https://a.example/1" }] }],
    plan: { audience: "Solo photographers", goal: "5 of 10 sign up", build: "A final notice", wrong: "A notice changes nothing", test: "Try it with 5", pass: "2 of 5 pay" },
    known: [{ kind: "product", name: "HoneyBook", text: "It costs $19 a month.", title: "Pricing", url: "https://h.example" }],
    ...o,
  });

  it("has what was found, what's decided and what's read elsewhere, with links back", () => {
    const h = reportHtml(data());
    for (const part of ["84 quotes from 7 places", "Couples don&#39;t pay the balance", "“She ghosted me.”", '<a href="https://a.example/1" rel="noreferrer">a.example</a>', "Solo photographers", "What would prove it wrong", "Read elsewhere", "HoneyBook: It costs $19 a month.", "not proof"]) expect(h).toContain(part);
  });

  it("fetches nothing and runs nothing, whatever it's fed", () => {
    const evil = '<script>alert(1)</script><img src="https://evil.example/x.png">';
    const h = reportHtml(data({ about: evil, problems: [{ id: "t", title: evil, line: evil, quotes: [{ text: evil, source: evil, url: "javascript:alert(1)" }] }], known: [{ kind: "published", text: evil, title: evil, url: "data:text/html,x" }], plan: { build: evil } }));
    expect(h).not.toMatch(/<script/i);
    expect(h).not.toMatch(/<img/i);
    expect(h).not.toContain("javascript:");
    expect(h).not.toContain('href="data:');
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("default-src 'none'");
    expect(h).not.toMatch(/\b(src|href)="(?!https?:)/);
    expect(h).not.toMatch(/url\(/);
  });

  it("follows the reader's light or dark, and lets each language set its own direction", () => {
    const h = reportHtml(data({ problems: [{ id: "t", title: "العملاء لا يدفعون", line: "", quotes: [{ text: "لم يدفع الزبون", source: "x", url: "https://x.example" }] }] }));
    expect(h).toContain("prefers-color-scheme:dark");
    expect(h).toContain('<h3 dir="auto">العملاء لا يدفعون</h3>');
    expect(h).toContain('<blockquote dir="auto">');
  });

  it("leaves out what it hasn't got", () => {
    const h = reportHtml(data({ plan: undefined, known: [] }));
    expect(h).not.toContain("Read elsewhere");
    expect(h).not.toContain('class="card"');
  });
});
