import { describe, expect, it } from "vitest";
import { routeOf, titleFrom } from "./route";

const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");

describe("what a message to the canvas's chat is for", () => {
  it("is nothing when nothing was sent", () => {
    expect(routeOf({ text: "  ", docs: [] })).toBeNull();
  });

  it("takes a mode a button set", () => {
    expect(routeOf({ text: "Parents stop ordering", docs: [], mode: "goal" })).toEqual({ job: "goal" });
    expect(routeOf({ text: long, docs: [], mode: "ask" })).toEqual({ job: "ask" });
  });

  it("asks the organization a question", () => {
    expect(routeOf({ text: "Why do riders cancel after a driver is assigned?", docs: [] })).toEqual({ job: "ask", read: true });
    expect(routeOf({ text: "what do drivers say about New Cairo", docs: [] })).toEqual({ job: "ask", read: true });
    // Whether a question asks what's known or asks to work something out is read by a call; a mode set on the box skips it.
    expect(routeOf({ text: "What should I build? What modules?", docs: [] })).toEqual({ job: "ask", read: true });
    expect(routeOf({ text: "What should I build? What modules?", docs: [], mode: "plan" })).toEqual({ job: "plan" });
  });

  it("takes in any doc, whatever it is, and a paste that reads as who said what", () => {
    expect(routeOf({ text: "", docs: [{}] })).toEqual({ job: "take" });
    expect(routeOf({ text: "", docs: [{ basis: "measured" }] })).toEqual({ job: "take" });
    expect(routeOf({ text: long, docs: [{ basis: "own" }, {}] })).toEqual({ job: "take" });
    expect(routeOf({ text: "Sara: the driver kept moving away", docs: [], pasted: "customers" })).toEqual({ job: "take" });
  });

  it("reads their own long text, or a doc they say is their own thinking, as a brain dump", () => {
    expect(routeOf({ text: long, docs: [] })).toEqual({ job: "dump" });
    expect(routeOf({ text: "First thought\nSecond thought\nThird thought", docs: [] })).toEqual({ job: "dump" });
    expect(routeOf({ text: "", docs: [{ basis: "own" }] })).toEqual({ job: "dump" });
    // A long question is thinking out loud, read as a dump.
    expect(routeOf({ text: `${long}?`, docs: [] })).toEqual({ job: "dump" });
  });

  it("works a short statement out with them, with a way to just add it, the goal first when it has a number", () => {
    expect(routeOf({ text: "Customers can't plan around the delivery window", docs: [] })).toEqual({ job: "consult", first: "problem" });
    expect(routeOf({ text: "Raise driver acceptance in New Cairo above 85%", docs: [] })).toEqual({ job: "consult", first: "goal" });
    // The tester's sentence: not a scan, and not two buttons.
    expect(routeOf({ text: "I want to work on a problem on my basket page in my delivery app", docs: [] })).toEqual({ job: "consult", first: "problem" });
  });

  it("titles a card in their words, on one line", () => {
    expect(titleFrom("  More riders\n  finish   trips ")).toBe("More riders finish trips");
    expect(titleFrom("x".repeat(300))).toHaveLength(200);
  });

  it("works an app's link out with them, its reviews offered, and reads it only when the box is set to", () => {
    expect(routeOf({ text: "https://apps.apple.com/us/app/x/id11", docs: [] })).toEqual({ job: "consult", offer: "scan" });
    expect(routeOf({ text: "https://apps.apple.com/us/app/x/id11", docs: [{}] })).toEqual({ job: "take" });
    expect(routeOf({ text: "a meal planner", docs: [], mode: "scan" })).toEqual({ job: "scan" });
  });
});
