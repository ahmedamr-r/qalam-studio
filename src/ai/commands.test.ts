import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commandFor, promptArgs, shimScript } from "./commands";

const SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`;

describe("starting a CLI on this platform", () => {
  it("starts the binary itself on a Mac, and a Windows .exe as it is", () => {
    expect(commandFor("/opt/homebrew/bin/claude", { platform: "darwin" })).toEqual({ command: "/opt/homebrew/bin/claude", args: [], env: {} });
    expect(commandFor("C:\\Users\\a\\.local\\bin\\claude.exe", { platform: "win32" })).toEqual({ command: "C:\\Users\\a\\.local\\bin\\claude.exe", args: [], env: {} });
  });

  it("runs an npm shim's script with Node, never through cmd.exe", () => {
    const bin = "C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd";
    expect(shimScript(SHIM, "C:\\Users\\a\\AppData\\Roaming\\npm")).toBe("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js");
    const read = () => SHIM;
    expect(commandFor(bin, { platform: "win32", read, env: { PATH: "C:\\Windows;C:\\Program Files\\nodejs" }, exists: (p) => p === "C:\\Program Files\\nodejs\\node.exe" })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"],
      env: {},
    });
    // No Node on the PATH: the desktop app's own binary runs as Node.
    expect(commandFor(bin, { platform: "win32", read, env: { PATH: "" }, exists: () => false, electron: "C:\\Qalam\\Qalam Studio.exe" })).toMatchObject({ command: "C:\\Qalam\\Qalam Studio.exe", env: { ELECTRON_RUN_AS_NODE: "1" } });
  });

  it("puts a system prompt in a file on Windows, and removes it after", () => {
    expect(promptArgs("Be brief.", "darwin").args).toEqual(["--system-prompt", "Be brief."]);
    const p = promptArgs("Be brief.", "win32");
    expect(p.args[0]).toBe("--system-prompt-file");
    expect(readFileSync(p.args[1], "utf8")).toBe("Be brief.");
    p.done();
    expect(existsSync(p.args[1])).toBe(false);
  });
});
