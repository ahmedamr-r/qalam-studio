// The desktop app as electron-builder packages it (release/app, its project folder): the built UI
// (dist/), the Node entries (out/), a package.json naming only what the installed app loads at
// runtime (node-llama-cpp, for search by meaning) and the Electron it runs on, and that package
// installed by npm for this Mac. The repository's own package.json lists Electron as a
// dependency, for `npx qalam-studio`, and electron-builder won't package an app that does; nor
// should it gather modules through the repository's pnpm lockfile: hence a folder of its own.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = path.join(root, "release", "app");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

for (const dir of ["out", "dist"]) if (!existsSync(path.join(root, dir))) throw new Error(`${dir}/ is missing: run pnpm build && pnpm build:desktop first.`);

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
for (const dir of ["out", "dist"]) cpSync(path.join(root, dir), path.join(app, dir), { recursive: true });
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "TRADEMARKS.md"]) cpSync(path.join(root, file), path.join(app, file));

const runtime = { "node-llama-cpp": pkg.optionalDependencies["node-llama-cpp"] };
// The Electron that's installed here, exactly: electron-builder packages that version.
const electron = JSON.parse(readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
writeFileSync(
  path.join(app, "package.json"),
  `${JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, license: pkg.license, author: "Ahmed Amr", type: pkg.type, main: pkg.main, dependencies: runtime, devDependencies: { electron } }, null, 2)}\n`,
);
// Its prebuilt binaries come as packages for each platform; its install script would only check
// them. The lockfile npm writes tells electron-builder which package manager to ask.
execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: app, stdio: "inherit" });
console.log(`Staged Qalam Studio ${pkg.version} in ${path.relative(root, app)}`);
