// Qalam's screenshot reader (native/see): built with this Mac's Swift and put beside the Node
// entries as out/qalam-see, where the desktop app (its Resources, electron-builder.yml) and
// `npx qalam-studio` find it (server/see). Off a Mac, or without Xcode's Swift, it says why and
// the app runs without it: screens are still read, but no word on a screenshot can be checked.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = path.join(root, "native", "see");

if (process.platform !== "darwin") {
  console.log("Screenshot reader: skipped (it's for macOS).");
  process.exit(0);
}
try {
  execFileSync("swift", ["build", "-c", "release", "--arch", "arm64"], { cwd: pkg, stdio: "inherit" });
} catch {
  console.warn("Screenshot reader: Swift couldn't build it (Xcode's Swift is needed). The app runs without checking words on screenshots.");
  process.exit(process.env.CI ? 1 : 0);
}
const built = path.join(pkg, ".build", "release", "qalam-see");
if (!existsSync(built)) throw new Error(`Screenshot reader: ${built} is missing after the build.`);
mkdirSync(path.join(root, "out"), { recursive: true });
cpSync(built, path.join(root, "out", "qalam-see"));
console.log("Screenshot reader: out/qalam-see");
