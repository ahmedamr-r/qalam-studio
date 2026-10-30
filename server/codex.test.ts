import { describe, expect, it } from "vitest";
import { codexLogin, findCodex } from "./codex";

describe("Codex on this computer", () => {
  it("is found on the PATH, in a usual folder, or inside the ChatGPT app", () => {
    const has = (...files: string[]) => (p: string) => files.includes(p);
    expect(findCodex({ PATH: "/usr/bin:/x/bin" }, has("/x/bin/codex"), "/home/a")).toBe("/x/bin/codex");
    expect(findCodex({ PATH: "/usr/bin" }, has("/Applications/ChatGPT.app/Contents/Resources/codex"), "/home/a")).toBe("/Applications/ChatGPT.app/Contents/Resources/codex");
    expect(findCodex({ PATH: "/usr/bin", QALAM_CODEX_BIN: "/stand/in" }, has(), "/home/a")).toBe("/stand/in");
    expect(findCodex({ PATH: "/usr/bin" }, has(), "/home/a")).toBeNull();
  });

  it("is found on Windows as npm's shim or a native .exe", () => {
    const has = (...files: string[]) => (p: string) => files.includes(p);
    expect(findCodex({ PATH: "C:\\Windows", APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, has("C:\\Users\\a\\AppData\\Roaming\\npm\\codex.cmd"), "C:\\Users\\a", "win32")).toBe("C:\\Users\\a\\AppData\\Roaming\\npm\\codex.cmd");
    expect(findCodex({ PATH: "C:\\Tools;C:\\Windows" }, has("C:\\Tools\\codex.exe"), "C:\\Users\\a", "win32")).toBe("C:\\Tools\\codex.exe");
  });

  it("reads codex login status: with ChatGPT, with a key, or not signed in", () => {
    expect(codexLogin("Logged in using ChatGPT\n")).toEqual({ signedIn: true, method: "chatgpt" });
    expect(codexLogin("Logged in using an API key - sk-***abcd\n")).toEqual({ signedIn: true, method: "api-key" });
    expect(codexLogin("Not logged in\n")).toEqual({ signedIn: false });
    expect(codexLogin("")).toEqual({ signedIn: null });
  });
});
