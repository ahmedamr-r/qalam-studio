import { describe, expect, it } from "vitest";
import { termPieces } from "@/hub/pieces";
import { sameTopic } from "@/hub/topics";
import { statementMaterial, sanitizeStatement } from "@/space/statement";
import { editTerms, termFor, termsEditOf } from "./edit";
import { clashes, termsFold } from "./fold";
import { termsFromMarkdown, termsToMarkdown } from "./terms-md";
import { termsText } from "./text";
import { emptyTerms, type Terms } from "./types";

let n = 0;
const o = { now: 1000, id: () => `t${++n}` };
const basket = (): Terms => editTerms(emptyTerms(), { op: "add", term: "Basket", means: "The order being built before checkout", avoid: ["cart", "trolley"], by: "qalam" }, o);

describe("hub/terms.md", () => {
  it("reads back what it writes, records and all", () => {
    const t = editTerms(basket(), { op: "add", term: "Active buyer", means: "Someone who ordered in the last 30 days.", avoid: ["active user"] }, o);
    const md = termsToMarkdown(t, { org: "Basket Co" });
    expect(md).toContain("- **Basket**: The order being built before checkout. Avoid: cart, trolley.");
    expect(termsFromMarkdown(md)).toEqual(t);
  });

  it("makes a term a person's once they change its words in the file", () => {
    const md = termsToMarkdown(basket(), { org: "X" }).replace("before checkout", "before paying");
    const [t] = termsFromMarkdown(md).terms;
    expect(t).toMatchObject({ means: "The order being built before paying.", by: "you" });
  });

  it("reads a line written by hand, with no record, as the person's", () => {
    const t = termsFromMarkdown("## Words\n\n- Rider: Someone who delivers orders. Avoid: driver, courier\n");
    expect(t.terms).toEqual([expect.objectContaining({ term: "Rider", means: "Someone who delivers orders.", avoid: ["driver", "courier"], by: "you" })]);
  });

  it("keeps what's under a heading it doesn't know, and a person's line above the words", () => {
    const md = `${termsToMarkdown(basket(), { org: "X" })}\n## Why we say basket\n\nOur app came from a grocery chain.\n`.replace("# The words at X\n", "# The words at X\n\nA note of ours.\n");
    const t = termsFromMarkdown(md);
    expect(t.notes).toContain("## Why we say basket");
    expect(t.notes).toContain("Our app came from a grocery chain.");
    expect(t.notes).toContain("A note of ours.");
    expect(termsFromMarkdown(termsToMarkdown(t, { org: "X" })).notes).toBe(t.notes);
  });

  it("reads nothing from a file of another version, and loses nothing", () => {
    const t = termsFromMarkdown('---\nqalam: "terms/9"\n---\n\n## Words\n\n- **A**: B.\n');
    expect(t.terms).toEqual([]);
    expect(t.notes).toContain("- **A**: B.");
  });
});

describe("changing the project's words", () => {
  it("fixes a term as the person's, and refuses a fix onto another term's word", () => {
    const t = editTerms(basket(), { op: "add", term: "Rider", means: "Someone who delivers" }, o);
    const id = t.terms[0].id;
    const fixed = editTerms(t, { op: "fix", id, means: "What they're about to pay for" }, { ...o, now: 2000 });
    expect(fixed.terms[0]).toMatchObject({ means: "What they're about to pay for.", by: "you", at: 2000 });
    expect(editTerms(t, { op: "fix", id, term: "rider" }, o)).toBe(t);
  });

  it("remembers a term taken off, until a person adds it back", () => {
    const t = basket();
    const off = editTerms(t, { op: "remove", id: t.terms[0].id }, o);
    expect(off.terms).toEqual([]);
    expect(off.gone).toEqual(["basket"]);
    expect(editTerms(off, { op: "add", term: "Basket", means: "x" }, o).gone).toEqual([]);
  });

  it("takes an edit only as a request can say it", () => {
    expect(termsEditOf({ op: "add", term: "Basket", means: "x", avoid: ["cart", 3] })).toEqual({ op: "add", term: "Basket", means: "x", avoid: ["cart"] });
    expect(termsEditOf({ op: "add", term: "Basket", means: " " })).toBeNull();
    expect(termsEditOf({ op: "fix", id: "t1" })).toBeNull();
    expect(termsEditOf({ op: "remove", id: "t1" })).toEqual({ op: "remove", id: "t1" });
    expect(termsEditOf({ op: "drop", id: "t1" })).toBeNull();
  });

  it("takes the same term added again as its fix, and keeps the words to avoid clean", () => {
    const t = editTerms(basket(), { op: "add", term: "basket", means: "The order before paying", avoid: ["Cart", "cart", "basket", ""] }, o);
    expect(t.terms).toHaveLength(1);
    expect(t.terms[0]).toMatchObject({ term: "Basket", means: "The order before paying.", avoid: ["Cart"] });
    expect(termFor(t, "cart")?.term).toBe("Basket");
  });
});

describe("folding and clashes", () => {
  it("writes avoided words as their term, whole words and plurals only", () => {
    const fold = termsFold(basket());
    expect(fold("Cart abandonment at checkout")).toBe("Basket abandonment at checkout");
    expect(fold("Carts left behind")).toBe("Baskets left behind");
    expect(fold("Cartography app")).toBe("Cartography app");
    expect(termsFold(emptyTerms())("Cart")).toBe("Cart");
  });

  it("finds the words to avoid in what someone wrote", () => {
    expect(clashes(basket(), "People drop their cart, then their trolley")).toEqual([{ word: "cart", term: "Basket" }]);
    expect(clashes(basket(), "Nothing here")).toEqual([]);
  });

  it("makes two problems in different words one problem where the project says so", () => {
    const fold = termsFold(basket());
    expect(sameTopic("Cart abandonment at checkout", "Basket abandonment at checkout")).toBe(false);
    expect(sameTopic("Cart abandonment at checkout", "Basket abandonment at checkout", fold)).toBe(true);
    expect(sameTopic("Late deliveries", "Basket abandonment at checkout", fold)).toBe(false);
  });

  it("is a piece search and Ask can find, and a name a statement may use", () => {
    const t = basket();
    expect(termPieces(t, "Basket Co").pieces).toEqual([expect.objectContaining({ ref: `hub:term:${t.terms[0].id}`, type: "context", sub: "term", text: "Basket: The order being built before checkout. Avoid: cart, trolley.", title: "Basket" })]);
    const m = statementMaterial({ what: "problem", said: "people leave things in it", org: "Co", about: "", market: "", words: termsText(t) });
    expect(m.text).toContain("- Basket: The order being built before checkout.");
    expect(sanitizeStatement({ statement: "Customers leave items in their Basket", why: "" }, m)?.statement).toBe("Customers leave items in their Basket");
  });

  it("puts the words a call's material uses first, and stops at its size", () => {
    const t = editTerms(basket(), { op: "add", term: "Rider", means: "Someone who delivers orders" }, o);
    expect(termsText(t, { near: "a rider's shift" }).split("\n")[1]).toMatch(/^- Rider/);
    expect(termsText(t, { max: 200 }).split("\n")).toHaveLength(2);
    expect(termsText(emptyTerms())).toBe("");
  });
});
