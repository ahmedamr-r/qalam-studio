import { describe, expect, it } from "vitest";
import { MAX_SPEAKERS, parseSttParams } from "./params";

const ok = { provider: "local", spoken: "ar", dialect: "egyptian", speakers: { min: 2, max: 2 }, keyterms: ["Talabat"], durationSec: 1800 };

describe("parseSttParams", () => {
  it("takes one language per interview, Arabic or English", () => {
    expect(parseSttParams(ok)).toEqual(ok);
    expect(parseSttParams({ ...ok, spoken: "en", dialect: undefined })).toMatchObject({ spoken: "en" });
    expect(parseSttParams({ ...ok, spoken: "mixed" })).toBeNull();
  });

  it("refuses what an engine can't do", () => {
    expect(parseSttParams({ ...ok, speakers: { min: 3, max: 2 } })).toBeNull();
    expect(parseSttParams({ ...ok, speakers: { min: 1, max: MAX_SPEAKERS + 1 } })).toBeNull();
    expect(parseSttParams({ ...ok, provider: "whisper" })).toBeNull();
    expect(parseSttParams({ ...ok, durationSec: -1 })).toBeNull();
    expect(parseSttParams(null)).toBeNull();
  });
});
