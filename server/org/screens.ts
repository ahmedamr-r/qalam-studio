import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { seesPictures } from "@/ai/abilities";
import { backend } from "@/ai/engine";
import { screensCall } from "@/ai/screens";
import type { ShotImage } from "@/ai/seen";
import { aiConfigured, structured } from "@/ai/server";
import { SECTION_LABEL } from "@/business/types";
import type { Ingested } from "@/discovery/ingest/core";
import { sureLines } from "@/discovery/ingest/image";
import type { SourceRecord } from "@/discovery/sources";
import { goalLine } from "@/goals/text";
import type { ShotRead } from "@/seen/shot";
import { ORG_SEEN, type ShotNote } from "@/seen/types";
import { reviewMaterial, sanitizeScreenReview, type ReviewFocus, type ReviewScreen } from "@/screens/review";
import { KEEP_MAX, REVIEW_LIMITS, type KeptShot, type KeptShots, type ScreenReview, type ShownShot } from "@/screens/types";
import { captureSource, newSource } from "../capture";
import { NO_IMAGE_READER, readImage, type ImageDeps } from "../image";
import { prepShot, readShots, seeAvailable } from "../see";
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

/** A finding taken onto the canvas or left out, kept on its look (null: no such look or finding). */
export async function decideFinding(store: OrgStore, id: string, key: string, decision: "accepted" | "discarded", o: { tab?: string } = {}): Promise<ScreenReview | null> {
  let found = false;
  const next = await store.changeScreenReview(
    id,
    (r) => {
      if (!r || !r.findings.some((f) => f.key === key)) return r;
      found = true;
      return { ...r, decided: { ...r.decided, [key]: decision } };
    },
    o,
  );
  return found ? next : null;
}

// ---------------------------------------------------------------------------
// The review: what on the screens bears on the problem they're working out

/** What a look reaches for besides the store: this Mac's words and copies, whether the engine sees, and Qalam AI (stand-ins in tests). */
export interface ReviewDeps {
  sees: () => boolean;
  reader: () => Promise<boolean>;
  words: (orgDir: string, shots: { hash: string; file: string }[]) => Promise<Map<string, ShotRead | null>>;
  prep: typeof prepShot;
  call: (opts: ReturnType<typeof screensCall>, signal?: AbortSignal) => Promise<{ data: unknown; model?: string }>;
}

const reviewDeps: ReviewDeps = {
  sees: () => aiConfigured() && seesPictures(backend()),
  reader: seeAvailable,
  words: (dir, shots) => readShots(dir, shots),
  prep: prepShot,
  call: (opts, signal) => structured<unknown>(opts, signal),
};

/** The longest side of a screenshot the look is sent. */
const LOOK_SIDE = 1568;
const PICTURE = /^image\/(png|jpeg|webp|gif)$/;

/**
 * Look at the screens an answer gave for the problem they're working out: every finding that bears on it,
 * ranked, a change each, from the customer's side and the business's, kept as code holds it
 * (src/screens/review.ts), in hub/seen/reviews. An engine that can't see pictures isn't asked: the look
 * says so, and the screens stay kept. None: nothing given was a screen.
 */
export async function reviewShots(
  store: OrgStore,
  o: { kept: KeptShots; focus: ReviewFocus; product: string | null; answers?: readonly { q: string; a: string }[]; emit?: (label: string) => void; signal?: AbortSignal; tab?: string; deps?: Partial<ReviewDeps> },
): Promise<ScreenReview | null> {
  const d = { ...reviewDeps, ...o.deps };
  const shown = o.kept.shots.filter((s) => s.screen).slice(0, REVIEW_LIMITS.screens);
  if (!shown.length) return null;
  const base = { v: 1 as const, id: nanoid(10), at: Date.now(), map: o.kept.map, ...(o.kept.flow ? { flow: o.kept.flow } : {}), focus: o.focus.said.replace(/\s+/g, " ").trim().slice(0, 600), shots: shown.map((s) => ({ asset: s.asset, name: s.screen!.name, screen: s.screen!.key, source: s.source })), findings: [], left: [] };
  const keep = (r: ScreenReview) => store.changeScreenReview(r.id, () => r, o.tab ? { tab: o.tab } : {}).then(() => r);
  if (!d.sees()) return keep({ ...base, unseen: true });

  o.emit?.(shown.length === 1 ? "Looking at the screen for what you're working out" : `Looking at the ${shown.length} screens for what you're working out`);
  const files = shown.flatMap((s) => {
    const a = store.getAsset(s.asset);
    return a ? [{ hash: s.asset, file: a.file, type: a.type }] : [];
  });
  const reader = await d.reader();
  const read = reader ? await d.words(store.dir, files.map(({ hash, file }) => ({ hash, file }))).catch(() => new Map<string, ShotRead | null>()) : new Map<string, ShotRead | null>();
  const screens: ReviewScreen[] = shown.map((s, i) => ({ id: `s${i + 1}`, shot: s.asset, name: s.screen!.name, screen: s.screen!.key, read: reader ? (sureLines(read.get(s.asset)) ?? null) : null }));
  const images = await Promise.all(
    files.map(async (f) => {
      const copy = await d.prep(store.dir, f.hash, f.file, LOOK_SIDE, "png").catch(() => ({ file: f.file, type: f.type }));
      return PICTURE.test(copy.type) ? { hash: f.hash, image: { mediaType: copy.type as ShotImage["mediaType"], data: (await readFile(copy.file)).toString("base64") } } : { hash: f.hash, image: null };
    }),
  );
  const business = (await store.getBusiness())?.lines.map((l) => `${SECTION_LABEL[l.section]}: ${l.text}${l.by === "qalam" ? " (Qalam AI's reading of their answers)" : ""}`) ?? [];
  const tree = await store.getGoals();
  const goals = tree.goals.filter((g) => g.status === "active" && (!o.product || !g.product || g.product === o.product)).slice(0, 8).map((g) => goalLine(tree, g.id));
  const m = reviewMaterial({ screens, focus: o.focus, ...(o.kept.flow ? { flow: o.kept.flow.name } : {}), business, goals, answers: o.answers ?? [] });
  const call = screensCall({ intro: m.intro, screens: m.screens.map((s, i) => ({ head: s.head, words: s.words, image: images.find((x) => x.hash === screens[i].shot)?.image ?? null })) });
  const { data, model } = await d.call(call, o.signal);
  if (o.signal?.aborted) throw new DOMException("Stopped", "AbortError");
  const checked = sanitizeScreenReview(data, { screens, sent: m.sent, also: m.also });
  // One they left out on the canvas before isn't raised again from the same screenshot.
  const dropped = new Set((await store.listScreenReviews()).flatMap((r) => Object.entries(r.decided ?? {}).flatMap(([k, d]) => (d === "discarded" ? [k] : []))));
  const kept = { ...checked, findings: checked.findings.filter((f) => !dropped.has(f.key)), left: [...checked.left, ...checked.findings.filter((f) => dropped.has(f.key)).map((f) => ({ what: f.title, why: "You left it out on the canvas before" }))] };
  await store
    .putTrace({ id: nanoid(10), projectId: "screens", kind: "screen-review", at: Date.now(), ...(model ? { model } : {}), focus: base.focus, screens: screens.map((s) => ({ id: s.id, name: s.name, read: !!s.read })), answer: data, kept: kept.findings.map((f) => ({ title: f.title, side: f.side, on: f.on?.words, change: f.change?.does })), dropped: kept.left } as { id: string; projectId: string })
    .catch(() => {});
  return keep({ ...base, findings: kept.findings, left: kept.left, ...(kept.none ? { none: true as const } : {}), ...(screens.every((s) => !s.read) ? { unread: true as const } : {}) });
}
