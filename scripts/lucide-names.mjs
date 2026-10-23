// Writes src/design-system/lucide-names.json: the canonical kebab-case name of every icon in the
// installed lucide package (its file names; aliases are left out). Run after upgrading lucide:
//   node scripts/lucide-names.mjs
import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dir = join(dirname(require.resolve("lucide")), "..", "esm", "icons");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => f.slice(0, -4))
  .sort();
writeFileSync(new URL("../src/design-system/lucide-names.json", import.meta.url), JSON.stringify(names) + "\n");
console.log(`${names.length} lucide icons`);
