import { describe, expect, it } from "vitest";
import { diagnose, worstDot, type HealthFacts } from "./doctor";

const fine: HealthFacts = { engine: { kind: "cli", ready: true, word: "Ready" }, search: { ok: true, node: "24.22.0" }, models: { status: "ready" }, inbox: { waiting: 0, notRead: 0, paused: false } };

describe("This Mac, checked", () => {
  it("says one quiet line when all is well, and gives the sidebar no dot", () => {
    const rows = diagnose(fine);
    expect(rows).toEqual([{ id: "all", dot: "ok", label: "This Mac", word: "All good" }]);
    expect(worstDot(rows)).toBeNull();
  });

  it("says how to fix Claude Code signed out, or not installed", () => {
    const out = diagnose({ ...fine, engine: { kind: "cli", ready: false, word: "Signed out", detail: "Run claude auth login" } });
    expect(out[0]).toMatchObject({ id: "engine", dot: "bad", word: "Signed out", fix: { id: "engine.signin", command: "claude auth login" } });
    expect(diagnose({ ...fine, engine: { kind: "cli", ready: false, word: "Not installed" } })[0].fix).toMatchObject({ id: "engine.install", href: expect.stringContaining("code.claude.com") });
    expect(diagnose({ ...fine, engine: { kind: "api", ready: false, word: "Key rejected" } })[0].fix?.id).toBe("engine.test");
    expect(diagnose({ ...fine, engine: { kind: "api", ready: false, word: "No key" } })[0].fix).toBeUndefined();
    expect(diagnose({ ...fine, engine: { kind: "ollama", ready: false, word: "Pick a model" } })[0].fix).toBeUndefined();
    expect(diagnose({ ...fine, engine: { kind: "codex", ready: false, word: "Signed out" } })[0].fix).toMatchObject({ id: "engine.signin", command: "codex login" });
    expect(diagnose({ ...fine, engine: { kind: "codex", ready: false, word: "Not installed" } })[0].fix).toMatchObject({ id: "engine.install", label: "Install Codex" });
    expect(diagnose({ ...fine, engine: { kind: "lmstudio", ready: false, word: "Offline" } })[0].fix?.id).toBe("engine.test");
  });

  it("speaks up for search off on old Node, a stopped meaning model, a download, and the inbox", () => {
    const rows = diagnose({
      ...fine,
      search: { ok: false, node: "22.13.0" },
      models: { status: "failed", error: "The models took too long" },
      inbox: { waiting: 0, notRead: 2, lastReason: "Qalam couldn't take in scan.pdf: no text in it", paused: false },
    });
    expect(rows.map((r) => [r.id, r.dot, r.word])).toEqual([
      ["search", "warn", "Off"],
      ["models", "warn", "Stopped"],
      ["inbox", "warn", "2 not read"],
    ]);
    expect(rows.find((r) => r.id === "models")?.fix?.id).toBe("models.retry");
    expect(diagnose({ ...fine, models: { status: "loading", download: { done: 18, total: 36 } } })[0]).toMatchObject({ id: "models", dot: "off", word: "Downloading 50%" });
  });

  it("says when the microphone is refused, only while a mic is on", () => {
    expect(diagnose({ ...fine, voice: { on: true, mic: "denied" } })[0]).toMatchObject({ id: "voice", dot: "warn", word: "Microphone off" });
    expect(diagnose({ ...fine, voice: { on: false, mic: "denied" } })[0].id).toBe("all");
    expect(diagnose({ ...fine, voice: { on: true, mic: "undetermined" } })[0].id).toBe("all");
  });

  it("says when this Mac can't read the words on screenshots, after what needs fixing", () => {
    expect(diagnose({ ...fine, see: { here: true } })[0].id).toBe("all");
    const rows = diagnose({ ...fine, see: { here: false }, search: { ok: false, node: "22.13.0" } });
    expect(rows.map((r) => [r.id, r.dot])).toEqual([
      ["search", "warn"],
      ["see", "off"],
    ]);
    expect(rows[1]).toMatchObject({ label: "Reading words on screenshots", word: "Not on this Mac", detail: expect.stringContaining("aren't checked") });
  });

  it("puts what blocks Qalam AI first, and says files wait for it", () => {
    const rows = diagnose({ ...fine, search: { ok: false, node: "22.13.0" }, engine: { kind: "cli", ready: false, word: "Signed out" }, inbox: { waiting: 3, notRead: 0, paused: true } });
    expect(rows.map((r) => r.id)).toEqual(["engine", "search", "inbox"]);
    expect(rows[2].word).toBe("3 waiting");
    expect(worstDot(rows)).toBe("bad");
  });
});
