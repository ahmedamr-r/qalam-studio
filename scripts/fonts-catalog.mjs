// Writes src/design-system/interview/fonts.json: the Google Fonts families the brand interview can
// suggest, each with the crowd-rated "Expressive" scores from the google/fonts repository (how
// Business, Calm, Playful… a family reads, 0–100), its classification, weights and Arabic support.
// Inputs are downloaded once and passed as files, so the script runs offline:
//   curl -sLO https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv
//   curl -sL -o gf-metadata.json https://fonts.google.com/metadata/fonts
//   node scripts/fonts-catalog.mjs families.csv gf-metadata.json
import { readFileSync, writeFileSync } from "node:fs";

const [csvPath, metaPath] = process.argv.slice(2);
if (!csvPath || !metaPath) {
  console.error("usage: node scripts/fonts-catalog.mjs families.csv gf-metadata.json");
  process.exit(1);
}

const EXPRESSIVE = ["business", "calm", "competent", "sincere", "sophisticated", "playful", "excited", "active", "futuristic", "innovative", "happy", "cute", "childlike", "vintage", "rugged", "awkward", "stiff", "loud", "fancy", "artistic"];
const CLASSES = {
  "/Sans/Geometric": "geometric",
  "/Sans/Humanist": "humanist",
  "/Sans/Grotesque": "grotesque",
  "/Sans/Neo Grotesque": "neo-grotesque",
  "/Sans/Rounded": "rounded",
  "/Sans/Superellipse": "superellipse",
  "/Serif/Transitional": "transitional",
  "/Serif/Old Style Garalde": "old-style",
  "/Serif/Humanist Venetian": "old-style",
  "/Serif/Modern": "modern",
  "/Serif/Slab": "slab",
};
// Arabic faces the interview pairs with a Latin font (always kept, whatever their scores).
const ARABIC = ["IBM Plex Sans Arabic", "Noto Sans Arabic", "Readex Pro", "Tajawal", "Almarai", "Noto Kufi Arabic"];
// Script, theme and novelty tags mark families that don't suit interface text; so do narrow cuts.
const NOT_UI = /^\/(Script|Theme|Seasonal|Purpose\/Learn To Write)/;
const NARROW = /Condensed|Narrow|Compressed|Expanded|Extended|Wide|SemiCondensed|^(Oswald|Smooch Sans|Bebas Neue|Anton|Teko|Fjalla One|Pathway Gothic One|Antonio|League Gothic|Unbounded|Belanosima|Syncopate|Michroma|Orbitron)$/;
// Faces drawn for large sizes: offered as a display (headline) font, never for body text.
const DISPLAY_ONLY = /Display|Headline|Poster|Hero/;

const tags = new Map();
for (const line of readFileSync(csvPath, "utf8").split("\n")) {
  const m = line.match(/^([^,]+),[^,]*,([^,]+),([\d.]+)$/);
  if (!m) continue;
  const [, family, tag, value] = m;
  if (!tags.has(family)) tags.set(family, new Map());
  tags.get(family).set(tag, Number(value));
}

const meta = JSON.parse(readFileSync(metaPath, "utf8")).familyMetadataList;
const weightsOf = (f) => {
  const wght = f.axes?.find((a) => a.tag === "wght");
  if (wght) return [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= wght.min && w <= wght.max);
  return [...new Set(Object.keys(f.fonts).filter((k) => /^\d+$/.test(k)).map(Number))].sort((a, b) => a - b);
};

const rows = [];
for (const f of meta) {
  const t = tags.get(f.family);
  const arabicFace = ARABIC.includes(f.family);
  if (!arabicFace && (!t || ![...t.keys()].some((k) => k.startsWith("/Expressive/")))) continue;
  if (!arabicFace && !["Sans Serif", "Serif"].includes(f.category)) continue;
  if (!arabicFace && (f.primaryScript || NARROW.test(f.family))) continue;
  if (!arabicFace && [...(t?.keys() ?? [])].some((k) => NOT_UI.test(k) && (t.get(k) ?? 0) >= 50)) continue;
  const weights = weightsOf(f);
  if (!weights.includes(400) || !weights.includes(700)) continue;
  const expressive = Object.fromEntries(EXPRESSIVE.map((k) => [k, Math.round(t?.get(`/Expressive/${k[0].toUpperCase()}${k.slice(1)}`) ?? 0)]));
  const cls = Object.entries(CLASSES)
    .map(([tag, name]) => [name, t?.get(tag) ?? 0])
    .sort((a, b) => b[1] - a[1])[0];
  rows.push({
    family: f.family,
    category: f.category === "Serif" ? "serif" : "sans",
    classification: cls && cls[1] > 0 ? cls[0] : f.category === "Serif" ? "transitional" : "neo-grotesque",
    weights,
    arabic: f.subsets.includes("arabic"),
    popularity: f.popularity,
    expressive,
    ...(arabicFace ? { arabicFace: true } : {}),
    ...(DISPLAY_ONLY.test(f.family) ? { displayOnly: true } : {}),
  });
}

// The most used families that read as interface text, plus the Arabic faces.
const ui = rows
  .filter((r) => !r.arabicFace)
  .filter((r) => r.weights.some((w) => w === 500 || w === 600))
  .sort((a, b) => a.popularity - b.popularity)
  .slice(0, 150);
const arabic = rows.filter((r) => r.arabicFace);
const out = [...ui, ...arabic].map(({ popularity, ...r }) => r);

writeFileSync(
  new URL("../src/design-system/interview/fonts.json", import.meta.url),
  JSON.stringify({ source: "google/fonts tags/all/families.csv + fonts.google.com/metadata/fonts", families: out }, null, 0) + "\n",
);
const missing = ARABIC.filter((a) => !arabic.some((r) => r.family === a));
console.log(`${ui.length} interface families, ${arabic.length} Arabic faces${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
