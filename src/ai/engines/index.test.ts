import { afterEach, describe, expect, it } from "vitest";
import { setEngineState } from "../engine";
import { structured } from "../server";
import { EngineError, registerAdapter } from "./index";

const call = { system: "s", content: [{ type: "text" as const, text: "x" }], schema: {}, effort: "low" as const, kind: "jobs" as const };

describe("the engine seam", () => {
  afterEach(() => setEngineState({ kind: "api", models: undefined }));

  it("runs an engine that isn't Claude through its adapter, on the model picked for the call's tier", async () => {
    registerAdapter("ollama", async ({ opts, model, send }) => send({ type: "result", data: { kind: opts.kind }, model }));
    setEngineState({ kind: "ollama", models: { decide: "qwen3:32b", read: "qwen3:8b" } });
    expect(await structured(call)).toEqual({ data: { kind: "jobs" }, model: "qwen3:32b" });
  });

  it("says what went wrong in the same way as Claude's paths", async () => {
    registerAdapter("lmstudio", async () => {
      throw new EngineError("no_model", "Pick a model for LM Studio in Connections.");
    });
    setEngineState({ kind: "lmstudio" });
    await expect(structured(call)).rejects.toThrow("Pick a model for LM Studio in Connections.");
  });
});
