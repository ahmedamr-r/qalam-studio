// Qalam's voice helper (native/voice): built with this Mac's Swift and put beside the Node
// entries as out/qalam-voice, where the desktop app (its Resources, electron-builder.yml) and
// `npx qalam-studio` find it (server/voice). Off a Mac, or without Xcode's Swift, it says why and
// the app runs without voice: the boxes have no mic, and people's own dictation still works.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = path.join(root, "native", "voice");

if (process.platform !== "darwin") {
  console.log("Voice helper: skipped (it's for macOS).");
  process.exit(0);
}
try {
  execFileSync("swift", ["build", "-c", "release", "--arch", "arm64"], { cwd: pkg, stdio: "inherit" });
} catch {
  console.warn("Voice helper: Swift couldn't build it (Xcode 26 or later is needed). The app runs without voice.");
  process.exit(process.env.CI ? 1 : 0);
}
const built = path.join(pkg, ".build", "release", "qalam-voice");
if (!existsSync(built)) throw new Error(`Voice helper: ${built} is missing after the build.`);
mkdirSync(path.join(root, "out"), { recursive: true });
cpSync(built, path.join(root, "out", "qalam-voice"));
console.log("Voice helper: out/qalam-voice");
