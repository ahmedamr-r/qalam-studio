import { describe, expect, it } from "vitest";
import { NO_VOICE, parseVoiceLine, voiceOffer, voiceUse, type VoiceFacts } from "./model";

const mac = (apple: boolean, parakeet = false): VoiceFacts => ({ here: true, apple: { available: apple, ready: apple }, parakeet: { installed: parakeet }, mic: "granted" });

describe("which engine the mic uses", () => {
  it("is Apple's where the Mac has it, unless they chose otherwise", () => {
    expect(voiceUse(null, mac(true))).toBe("apple");
    expect(voiceUse("own", mac(true))).toBeNull();
    expect(voiceUse("off", mac(true))).toBeNull();
    expect(voiceUse("parakeet", mac(true, true))).toBe("parakeet");
  });

  it("is none on a Mac without it until Parakeet is installed, and none off a Mac", () => {
    expect(voiceUse(null, mac(false))).toBeNull();
    expect(voiceUse("parakeet", mac(false))).toBeNull();
    expect(voiceUse("parakeet", mac(false, true))).toBe("parakeet");
    // An engine chosen on a Mac that lost it falls back to what's here.
    expect(voiceUse("apple", mac(false, true))).toBe("parakeet");
    expect(voiceUse("parakeet", mac(true, false))).toBe("apple");
    expect(voiceUse("apple", NO_VOICE)).toBeNull();
    expect([voiceOffer(mac(true)), voiceOffer(mac(false)), voiceOffer(NO_VOICE)]).toEqual(["apple", "parakeet", "none"]);
  });
});

describe("the helper's lines", () => {
  it("reads what it knows and nothing else", () => {
    expect(parseVoiceLine('{"t":"partial","text":"Boat owners"}')).toEqual({ t: "partial", text: "Boat owners" });
    expect(parseVoiceLine('{"t":"level","v":3}')).toEqual({ t: "level", v: 1 });
    expect(parseVoiceLine('{"t":"check","apple":{"available":true},"mic":"maybe"}')).toEqual({ t: "check", apple: { available: true, ready: false }, mic: "undetermined" });
    expect(parseVoiceLine('{"t":"error","code":"mic-denied"}')).toMatchObject({ t: "error", code: "mic-denied", message: "The voice helper stopped." });
    expect(parseVoiceLine('{"t":"shout"}')).toBeNull();
    expect(parseVoiceLine("not json")).toBeNull();
  });
});
