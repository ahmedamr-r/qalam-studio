import { describe, expect, it } from "vitest";
import { isAppLink, otherReading, projectName, scanCountry, scanInput } from "./input";

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
    expect(projectName({ kind: "idea", said: "A budgeting app for freelancers whose income changes every month" })).toBe("Budgeting app for freelancers whose income");
  });

  it("looks in the store their words name, else their region, else the US", () => {
    expect(scanCountry("grocery prices for families in Saudi Arabia", "en-US")).toBe("sa");
    expect(scanCountry("أسعار البقالة في السعودية")).toBe("sa");
    expect(scanCountry("a meal planner", "en-GB")).toBe("gb");
    expect(scanCountry("a meal planner", "en")).toBe("us");
    expect(scanCountry("a meal planner")).toBe("us");
  });
});
