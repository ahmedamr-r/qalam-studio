import { describe, expect, it } from "vitest";
import type { SetupLine, SetupSession } from "@/org/setup";
import type { Product } from "@/org/context-md";
import { placeKey, placeLine, placesOf, reviewOf } from "./places";

const line = (id: string, over: Partial<SetupLine> = {}): SetupLine => ({ id, to: "org", field: "context", text: id, pieces: [], answers: [], why: "", ...over });
const session = (lines: SetupLine[], over: Partial<SetupSession> = {}): SetupSession => ({ v: 1, phase: "review", understanding: "", challenges: [], buckets: [], proposal: { summary: "", products: [{ ref: "n1", name: "Uber rides", why: "" }], lines }, ...over });
const product = (id: string, name: string, over: Partial<Product> = {}): Product => ({ id, name, audience: "", context: "", segments: [], ...over });
const about = { context: "", audience: "" };

describe("the setup's places", () => {
  it("gives the About and each product its proposed lines, what each rests on, and what it says now", () => {
    const s = session([line("a1", { field: "audience", text: "Riders in Cairo", pieces: ["q1"] }), line("p1", { to: "new:n1", field: "segments", text: "Airport riders" }), line("p2", { to: "new:n1", field: "context", text: "Rides in Cairo" }), line("g1", { field: "goals", text: "More trips" })], { decided: { p1: "accepted" } });
    const places = placesOf({ org: "Uber", session: s, products: [], about: { context: "A ride app.", audience: "" }, quotes: [{ id: "q1", text: "riders in Cairo" }] });
    expect(places.map((p) => [p.key, p.title, p.fresh, p.lines.map((l) => [l.label, l.state])])).toEqual([
      ["org", "About Uber", false, [["Who we serve", "proposed"], ["What we do", "kept"]]],
      ["new:n1", "Uber rides", true, [["Context", "proposed"], ["Segments", "accepted"]]],
    ]);
    expect(places[0].lines[0]).toMatchObject({ pieces: ["q1"], rests: { quotes: ["riders in Cairo"] } });
  });

  it("keeps a proposed product's key once accepting made it, under the name it has now", () => {
    const s = session([line("p1", { to: "new:n1", field: "context", text: "Rides" })], { made: { n1: "prod1" }, decided: { p1: "accepted" } });
    const places = placesOf({ org: "Uber", session: s, products: [product("prod1", "Uber Rides", { audience: "Riders" })], about, quotes: [] });
    expect(places.map((p) => [p.key, p.title, p.fresh])).toEqual([
      ["org", "About Uber", false],
      ["new:n1", "Uber Rides", false],
    ]);
    expect(placeKey("prod1", s)).toBe("new:n1");
    expect(placeKey(null, s)).toBe("org");
  });

  it("doesn't show again, as what a place says now, what an accepted line put there", () => {
    const s = session([line("c", { to: "new:n1", text: "Rides in Cairo." }), line("s1", { to: "new:n1", field: "segments", text: "Airport riders" })], { made: { n1: "prod1" }, decided: { c: "accepted", s1: "accepted" } });
    const products = [product("prod1", "Uber rides", { context: "Rides in Cairo.", segments: ["Airport riders", "Cash payers"] })];
    const [, rides] = placesOf({ org: "Uber", session: s, products, about, quotes: [] });
    expect(rides.lines.map((l) => [l.label, l.state, l.text])).toEqual([
      ["Context", "accepted", "Rides in Cairo."],
      ["Segments", "accepted", "Airport riders"],
      ["Segments", "kept", "Cash payers"],
    ]);
  });

  it("shows the products there now, and those named at the know door, once each", () => {
    const places = placesOf({ org: "Basket", session: null, products: [product("g", "Grocery", { segments: ["Parents", "Offices"] })], about, quotes: [], named: ["Grocery", "Pantry"] });
    expect(places.map((p) => [p.key, p.fresh, p.lines.map((l) => l.text)])).toEqual([
      ["org", false, []],
      ["g", false, ["Parents, Offices"]],
      ["named:Pantry", true, []],
    ]);
  });

  it("says a place's lines in a few words", () => {
    expect(placeLine({ lines: [] })).toBe("Nothing written yet");
    const rows = placesOf({ org: "Uber", session: session([line("a"), line("b", { field: "audience" })], { decided: { a: "accepted" } }), products: [], about, quotes: [] })[0].lines;
    expect(placeLine({ lines: rows })).toBe("2 lines · 1 to review");
  });

  it("counts how the review stands", () => {
    const s = session([line("a"), line("b"), line("c")], { decided: { a: "accepted", b: "discarded" } });
    expect(reviewOf(s)).toEqual({ accepted: 1, discarded: 1, open: ["c"] });
    expect(reviewOf(null)).toEqual({ accepted: 0, discarded: 0, open: [] });
  });
});
