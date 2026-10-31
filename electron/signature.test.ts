import { describe, expect, it } from "vitest";
import { teamOf } from "./signature";

describe("teamOf", () => {
  it("reads the team of an app signed with a Developer ID", () => {
    const out = "Executable=/Applications/Example.app/Contents/MacOS/Example\nIdentifier=com.example.app\nAuthority=Developer ID Application: Example Inc (ABCDE12345)\nTeamIdentifier=ABCDE12345\n";
    expect(teamOf(out)).toBe("ABCDE12345");
  });

  it("names none for an app signed ad hoc", () => {
    const out = "Identifier=io.github.ahmedamr-r.qalam-studio\nFormat=app bundle with Mach-O thin (arm64)\nSignature=adhoc\nTeamIdentifier=not set\n";
    expect(teamOf(out)).toBeNull();
  });

  it("names none when there's no signature to read", () => {
    expect(teamOf("/Applications/Example.app: code object is not signed at all\n")).toBeNull();
  });
});
