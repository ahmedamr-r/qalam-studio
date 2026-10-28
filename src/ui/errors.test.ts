import { describe, expect, it } from "vitest";
import { errorFix } from "./errors";

describe("what fixes an AI error", () => {
  it("sends engine problems to Connections, in a few words", () => {
    expect(errorFix("Claude Code isn't signed in. Run `claude auth login` in a terminal, then try again.")?.word).toBe("Claude Code is signed out");
    expect(errorFix("Couldn't start Claude Code (spawn claude ENOENT). Install Claude Code or set CLAUDE_CLI_PATH.")?.word).toBe("Claude Code isn't installed");
    expect(errorFix("AI is not configured on this deployment.")?.word).toBe("Qalam AI isn't set up");
    expect(errorFix("401 invalid x-api-key")?.word).toBe("The API key was rejected");
    expect(errorFix("Qalam AI isn't set up here, so it can't answer.")?.href).toMatch(/connections$/);
  });

  it("leaves other errors as they came", () => {
    expect(errorFix("The model declined this request.")).toBeNull();
    expect(errorFix("The response was cut off. Try a simpler brief.")).toBeNull();
  });
});
