// What `npm pack` and `npm publish` must have before they go: the build runs on without the helpers on
// purpose, so the app still opens for someone working on it, but a package that went out without them
// would quietly lose voice and reading words on screenshots for everyone.
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const missing = ["dist/index.html", "out/main.js", "out/qalam-voice", "out/qalam-see"].filter((f) => !existsSync(path.join(root, f)));
if (missing.length) {
  console.error(`Not packing: ${missing.join(", ")} missing. The Mac helpers need a Mac with Xcode's Swift.`);
  process.exit(1);
}
