import type { Ingested } from "@/discovery/ingest/core";
import type { SourceRecord } from "@/discovery/sources";
import { ORG_SEEN, type ShotNote } from "@/seen/types";
import { KEEP_MAX, type KeptShot, type KeptShots, type ShownShot } from "@/screens/types";
import { captureSource, newSource } from "../capture";
import { NO_IMAGE_READER, readImage, type ImageDeps } from "../image";
import { addShots, flowName, productOf, type SeenDeps } from "./seen";
import type { OrgStore } from "./store";

/*
 * Screens in the conversation, in the core. The screenshots a question's answer gave are kept as the
 * product's screens (What people see, src/seen/), one flow in the order given, and each as a picture
 * source whose printed words are the product's own copy: never read for anyone's words, never filed.
 * What each one shows is read once (server/image.ts, cached by the picture), so the next turn can ask
 * about what's on them. A picture that isn't a screen (a chart, someone's reviews) is taken in as any
 * picture is.
 */

export { KEEP_MAX } from "@/screens/types";

/** A screenshot that couldn't be read here at all: kept by its name, nothing claimed about it. */
const unreadShot = (hash: string, title: string, type: string): Ingested => ({ kind: "image", title, origin: title, text: "", image: { asset: hash, type, shows: "screen", reading: [], unread: ["no-reader", "no-vision"] } });

/** What the screen is called and what's on it, from the picture's own reading (each line held to its print by sanitizeImage). */
const noteOf = (ing: Ingested): ShotNote => ({
  name: ing.title.slice(0, 80),
  kind: "other",
  ...(ing.about ? { does: ing.about.slice(0, 200) } : {}),
  ...(ing.image?.reading.length ? { on: ing.image.reading.join(" ").slice(0, 300) } : {}),
  can: [],
  nav: [],
});

/**
 * Keep the screenshots an answer gave: read each (its words on this Mac, one look by Qalam AI), keep
 * the screens in the product's map as one flow named for what was asked, and each as its source.
 */
export async function keepShots(store: OrgStore, o: { shots: readonly ShownShot[]; product: string | null; about: string; emit?: (label: string) => void; signal?: AbortSignal; tab?: string; deps?: { image?: ImageDeps; seen?: SeenDeps } }): Promise<KeptShots> {
  const map = o.product ?? ORG_SEEN;
  await productOf(store, map);
  const shots = o.shots
    .map((s) => ({ hash: s.asset.replace(/^asset:/, ""), title: s.title.replace(/\.(png|jpe?g|webp|gif|heic|heif)$/i, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Screenshot" }))
    .filter((s, i, all) => /^[0-9a-f]{24}$/.test(s.hash) && !!store.getAsset(s.hash) && all.findIndex((x) => x.hash === s.hash) === i)
    .slice(0, KEEP_MAX);
  if (!shots.length) throw new Error("None of these screenshots is in the project.");
  o.emit?.(shots.length === 1 ? "Reading the screenshot" : `Reading ${shots.length} screenshots`);
  const read = await Promise.all(
    shots.map((s) =>
      readImage(store, { asset: s.hash, name: s.title }, { signal: o.signal }, o.deps?.image).catch((e: unknown) => {
        // Nothing here can read it (no words, no eyes): it's still kept, by its name.
        if (!o.signal?.aborted && e instanceof Error && e.message === NO_IMAGE_READER) return unreadShot(s.hash, s.title, store.getAsset(s.hash)?.type ?? "image/png");
        throw e;
      }),
    ),
  );
  if (o.signal?.aborted) throw new DOMException("Stopped", "AbortError");

  // Shown in answer to a question about a screen: a screen unless its reading says it's something else.
  const isScreen = (ing: Ingested) => !ing.image || ing.image.shows === "screen";
  const screens = shots.map((s, i) => ({ ...s, ing: read[i] })).filter((s) => isScreen(s.ing));
  o.emit?.("Keeping them with your screens");
  const added = screens.length
    ? await addShots(
        store,
        map,
        screens.map((s) => ({ ref: `asset:${s.hash}`, name: s.title })),
        { flow: o.about, notes: Object.fromEntries(screens.map((s) => [`asset:${s.hash}`, noteOf(s.ing)])), ...(o.tab ? { tab: o.tab } : {}), ...(o.deps?.seen ? { deps: o.deps.seen } : {}) },
      )
    : null;

  const sources = await store.listSources();
  const out: KeptShot[] = [];
  for (const [i, s] of shots.entries()) {
    const ing = read[i];
    const printed = ing.text.slice(0, 2000);
    const base = { asset: s.hash, title: s.title, printed, ...(ing.image?.shows ? { shows: ing.image.shows } : {}), ...(ing.about ? { about: ing.about } : {}), ...(ing.image?.unread?.includes("no-vision") && ing.image?.unread?.includes("no-reader") ? { unread: true as const } : {}) };
    if (!isScreen(ing)) {
      // Something else they showed: taken in as any picture is.
      const r = await captureSource(store, ing, { product: o.product, ...(o.signal ? { signal: o.signal } : {}) });
      out.push({ ...base, source: r.sourceId });
      continue;
    }
    const key = added?.screenOf[`asset:${s.hash}`];
    const screen = key ? { map, key, name: added!.map.screens.find((x) => x.key === key)?.name ?? s.title } : undefined;
    // One source a screenshot: shown again, its source follows the screen it's kept as.
    const had = sources.find((x) => x.image?.asset === s.hash && x.screen);
    const rec: SourceRecord = had ? { ...had, ...(screen ? { screen: { map, key: screen.key } } : {}) } : { ...newSource(ing, { product: o.product }), ...(screen ? { screen: { map, key: screen.key } } : {}) };
    await store.putSource(rec, o.tab ? { tab: o.tab } : {});
    out.push({ ...base, source: rec.id, ...(screen ? { screen } : {}) });
  }
  const flow = added?.flow ? { key: added.flow, name: added.map.flows.find((f) => f.key === added.flow)?.name ?? flowName(o.about) } : undefined;
  return { map, ...(flow ? { flow } : {}), shots: out };
}
