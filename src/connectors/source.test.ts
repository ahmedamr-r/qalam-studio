import { describe, expect, it } from "vitest";
import { sourceLine, sourceOf } from "./source";

describe("where a goal's number was read", () => {
  it("names an analytics tool by its label, and it reads again", () => {
    expect(sourceOf({ connector: "posthog", ref: "abc", label: "Weekly orders" })).toEqual({ kind: "analytics", from: "PostHog", what: "Weekly orders", readsAgain: true });
    expect(sourceLine({ connector: "amplitude", ref: "1", label: "Signups", series: "Signups · All Users" })).toBe("Amplitude · Signups · Signups · All Users");
  });

  it("says a document's number stays as it was read, by the document's title, never its id", () => {
    const s = { connector: "document", ref: "src_8f2k", label: "Q3 board deck" };
    expect(sourceOf(s)).toEqual({ kind: "document", from: "a document", what: "Q3 board deck", readsAgain: false });
    expect(sourceLine(s)).toBe("A document · Q3 board deck");
  });

  it("reads a database metric again", () => {
    expect(sourceOf({ connector: "database", ref: "m1", label: "Revenue, last 30 days" })).toEqual({ kind: "database", from: "your database", what: "Revenue, last 30 days", readsAgain: true });
  });

  it("falls back to the ref, and a series that only repeats its chart says nothing more", () => {
    expect(sourceOf({ connector: "posthog", ref: "abc" }).what).toBe("abc");
    expect(sourceLine({ connector: "posthog", ref: "abc", label: "Orders", series: "Orders" })).toBe("PostHog · Orders");
    expect(sourceOf({ connector: "linear", ref: "ENG-1" })).toMatchObject({ kind: "other", from: "Linear", readsAgain: false });
  });
});
