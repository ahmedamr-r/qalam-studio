import { describe, expect, it } from "vitest";
import { isAppLink, otherReading, projectName, sanitizeFirstRead, saysNoIdea, scanCountry, scanInput } from "./input";

describe("what the box holds", () => {
  it("reads an App Store link, a website, a name and an idea", () => {
    expect(scanInput("https://apps.apple.com/us/app/x/id11")).toEqual({ kind: "product", name: "", app: "https://apps.apple.com/us/app/x/id11" });
    expect(scanInput("linear.app")).toEqual({ kind: "product", name: "Linear" });
    expect(scanInput("https://www.notion.so/pricing")).toEqual({ kind: "product", name: "Notion" });
    expect(scanInput("Duolingo")).toEqual({ kind: "product", name: "Duolingo" });
    expect(scanInput("Google Docs")).toEqual({ kind: "product", name: "Google Docs" });
    expect(scanInput("a meal planner")).toEqual({ kind: "idea", said: "a meal planner" });
    expect(scanInput("A meal planner for night-shift workers")).toEqual({ kind: "idea", said: "A meal planner for night-shift workers" });
    expect(scanInput("Meal Planner.")).toEqual({ kind: "idea", said: "Meal Planner." });
    expect(scanInput("تطبيق لمقارنة أسعار البقالة")).toEqual({ kind: "idea", said: "تطبيق لمقارنة أسعار البقالة" });
    expect(scanInput(" ")).toBeNull();
  });

  it("offers the other reading, and none for a link", () => {
    expect(otherReading({ kind: "product", name: "Meal Planner" }, "Meal Planner")).toEqual({ kind: "idea", said: "Meal Planner" });
    expect(otherReading({ kind: "idea", said: "a planner" }, "a planner")).toEqual({ kind: "product", name: "a planner" });
    expect(otherReading({ kind: "product", name: "", app: "https://apps.apple.com/us/app/x/id1" }, "x")).toBeNull();
    const sentence = "A tool that helps freelance designers chase late invoices";
    expect(otherReading({ kind: "idea", said: sentence }, sentence)).toBeNull();
    expect(otherReading({ kind: "idea", said: "Is it any good?" }, "Is it any good?")).toBeNull();
    expect(isAppLink("look at https://apps.apple.com/us/app/x/id1")).toBe(false);
  });

  it("names the project from their words, whole words only", () => {
    expect(projectName({ kind: "product", name: "Duolingo" })).toBe("Duolingo");
    expect(projectName({ kind: "product", name: "", app: "x" })).toBe("My product");
    expect(projectName({ kind: "idea", said: "a meal planner" })).toBe("Meal planner");
    // A sentence about it isn't a name: until the first read names it, or they do.
    expect(projectName({ kind: "idea", said: "A budgeting app for freelancers whose income changes every month" })).toBe("My project");
    expect(projectName({ kind: "idea", said: "I want to build something that makes money. I know React." })).toBe("My project");
  });

  it("looks in the store their words name, else their region, else the US", () => {
    expect(scanCountry("grocery prices for families in Saudi Arabia", "en-US")).toBe("sa");
    expect(scanCountry("أسعار البقالة في السعودية")).toBe("sa");
    expect(scanCountry("a meal planner", "en-GB")).toBe("gb");
    expect(scanCountry("a meal planner", "en")).toBe("us");
    expect(scanCountry("a meal planner")).toBe("us");
  });

  it("knows when words plainly name nothing to read about", () => {
    for (const s of ["no idea", "No idea yet", "idk", "I don't know", "not sure yet", "anything"]) expect(saysNoIdea(s)).toBe(true);
    for (const s of ["a meal planner", "No-code invoicing for freelancers who keep getting paid late", "Not sure how, but freelancers need to get paid faster by their clients"]) expect(saysNoIdea(s)).toBe(false);
    expect(sanitizeFirstRead({ said: "none", name: "Side income" }, "I want a side income").named).toBe(false);
    expect(sanitizeFirstRead({ said: "none", name: "Side income" }, "I want a side income").name).toBe("");
    expect(sanitizeFirstRead(null, "anything").named).toBe(true);
  });

  it("keeps a name a label, and a product's name only as they wrote it", () => {
    const said = "We run Basket, a grocery app for parents in Riyadh, and 30% of first orders never come back";
    expect(sanitizeFirstRead({ said: "named", product: "Basket", name: "Basket" }, said)).toEqual({ named: true, product: "Basket", name: "Basket" });
    expect(sanitizeFirstRead({ said: "named", product: "Bazaar", name: "“Grocery reorders.”" }, said)).toEqual({ named: true, product: "", name: "Grocery reorders" });
    // A sentence isn't a name, and a figure they didn't write can't be in one.
    expect(sanitizeFirstRead({ said: "named", product: "", name: "An app that helps parents reorder their weekly shop" }, said).name).toBe("");
    expect(sanitizeFirstRead({ said: "named", product: "", name: "Top 10 grocery fixes" }, said).name).toBe("");
    expect(sanitizeFirstRead({ said: "named", product: "", name: "30% reorders" }, said).name).toBe("30% reorders");
  });
});
