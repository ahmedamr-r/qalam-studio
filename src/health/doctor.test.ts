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

  it("puts what blocks Qalam AI first, and says files wait for it", () => {
    const rows = diagnose({ ...fine, search: { ok: false, node: "22.13.0" }, engine: { kind: "cli", ready: false, word: "Signed out" }, inbox: { waiting: 3, notRead: 0, paused: true } });
    expect(rows.map((r) => r.id)).toEqual(["engine", "search", "inbox"]);
    expect(rows[2].word).toBe("3 waiting");
    expect(worstDot(rows)).toBe("bad");
  });
});
