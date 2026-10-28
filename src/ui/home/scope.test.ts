import { describe, expect, it } from "vitest";
import { inScope, readScope, withScope } from "./scope";

describe("the product scope", () => {
  it("reads ?product=, everything when it's absent", () => {
    expect(readScope("")).toBe("all");
    expect(readScope("?product=org")).toBe("org");
    expect(readScope("?tab=x&product=grocery")).toBe("grocery");
  });

  it("puts a scope in the query, and leaves Everything out", () => {
    expect(withScope("", "grocery")).toBe("?product=grocery");
    expect(withScope("?product=grocery&card=a1", "all")).toBe("?card=a1");
    expect(withScope("?product=grocery", "all")).toBe("");
    expect(withScope("?product=a", "org")).toBe("?product=org");
  });

  it("matches what's for the whole organization, one product, or everything", () => {
    expect(inScope(null, "all")).toBe(true);
    expect(inScope("grocery", "all")).toBe(true);
    expect(inScope(null, "org")).toBe(true);
    expect(inScope("grocery", "org")).toBe(false);
    expect(inScope("grocery", "grocery")).toBe(true);
    expect(inScope(undefined, "grocery")).toBe(false);
  });
});
