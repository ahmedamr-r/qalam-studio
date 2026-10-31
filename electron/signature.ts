import { execFile } from "node:child_process";
import path from "node:path";

/**
 * Who signed the installed Mac app. A Developer ID names a team, and only then can the app install
 * an update (macOS checks that the new one is the same team's). Signed ad hoc (release.yml without
 * the Apple secrets, docs/install-mac.md), it names none.
 */

/** The team in `codesign -dv`'s answer, or null when it names none ("not set", or no signature). */
export function teamOf(codesign: string): string | null {
  const team = /^TeamIdentifier=(.+)$/m.exec(codesign)?.[1]?.trim();
  return team && team !== "not set" ? team : null;
}

/** The team that signed the running app: its bundle is two folders above the executable. */
export function signingTeam(): Promise<string | null> {
  const bundle = path.resolve(path.dirname(process.execPath), "..", "..");
  return new Promise((resolve) => execFile("/usr/bin/codesign", ["-dv", bundle], (_e, stdout, stderr) => resolve(teamOf(`${stdout}\n${stderr}`))));
}
