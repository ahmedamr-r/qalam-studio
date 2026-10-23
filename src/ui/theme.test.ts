import { describe, expect, it } from "vitest";
import { isThemeMode, resolveTheme, setThemeMode, useTheme } from "./theme";

describe("theme", () => {
  it("resolves system against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("only accepts known modes from storage", () => {
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("sepia")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  it("defaults to dark and survives missing storage", () => {
    expect(useTheme.getState()).toEqual({ mode: "dark", resolved: "dark" });
    setThemeMode("light");
    expect(useTheme.getState()).toEqual({ mode: "light", resolved: "light" });
    setThemeMode("system"); // no matchMedia in node: system reads as dark
    expect(useTheme.getState().resolved).toBe("dark");
  });
});
