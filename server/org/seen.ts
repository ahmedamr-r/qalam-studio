import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { placeCall, readCall, type ShotImage } from "@/ai/seen";
import { structured } from "@/ai/server";
import { stepRef } from "@/code/map";
import { foldPins } from "@/code/steps";
import { goalsText } from "@/goals/text";
import { contextText } from "@/org/context-md";
import { answersOf, placeMaterial, proposalOf, sanitizePlace } from "@/seen/place";
import { readMaterial, sanitizeRead } from "@/seen/read";
import { ORG_SEEN, SEEN_KEY, SEEN_LIMITS, type SeenAnswer, type SeenMap, type SeenReading, type SeenScreen, type SeenText, type Shot, type ShotNote } from "@/seen/types";
import { prepShot, readShots, seeAvailable } from "../see";
import { NotFoundError, type OrgStore } from "./store";

/**
 * What people see, in the core (src/seen/): a reading takes a batch of screenshots to the
 * product's map. This Mac reads each one's words (qalam-see), Qalam AI reads the screenshots in
 * batches, then places them in flows in rounds of questions; the person settles what's proposed.
 * A reading answers at once and goes on here, so leaving the page doesn't stop it; its state is in
 * chats/seen/<key>.json, and each step announces a `seen` event its window follows.
 */

/** What a reading uses besides the store: this Mac's words and copies, and Qalam AI (stand-ins in tests). */
export interface SeenDeps {
  words: (shots: { hash: string; file: string }[]) => Promise<Map<string, SeenText | null>>;
  available: () => Promise<boolean>;
  prep: (hash: string, file: string, maxSide: number, format: "png" | "jpeg") => Promise<{ file: string; type: string }>;
  ask: (call: ReturnType<typeof readCall> | ReturnType<typeof placeCall>) => Promise<{ data: unknown; model?: string }>;
}

const depsFor = (store: OrgStore): SeenDeps => ({
  words: (shots) => readShots(store.dir, shots),
  available: () => seeAvailable(),
  prep: (hash, file, max, format) => prepShot(store.dir, hash, file, max, format),
  ask: (call) => structured<unknown>(call),
});

/** Readings running in this process, by organization and key: one at a time each. */
const running = new Set<string>();

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
/** The long side of the copy Qalam AI reads, and of the small one it places with. */
const READ_SIDE = 1568;
const THUMB_SIDE = 768;

async function productOf(store: OrgStore, key: string): Promise<string | null> {
  if (!SEEN_KEY.test(key)) throw new NotFoundError("No such product");
  if (key === ORG_SEEN) return null;
  if (!(await store.listProducts()).some((p) => p.id === key)) throw new NotFoundError("No such product");
  return key;
}

const hashOf = (ref: string) => ref.replace(/^asset:/, "");

/** The words on screenshots, by their refs (none for one this Mac couldn't read). */
async function wordsFor(store: OrgStore, deps: SeenDeps, refs: string[]): Promise<Map<string, SeenText | undefined>> {
  const shots = refs.flatMap((ref) => {
    const a = store.getAsset(hashOf(ref));
    return a ? [{ hash: hashOf(ref), file: a.file }] : [];
  });
  const read = shots.length ? await deps.words(shots).catch(() => new Map<string, SeenText | null>()) : new Map<string, SeenText | null>();
  return new Map(refs.map((ref) => [ref, read.get(hashOf(ref)) ?? undefined]));
}

/** A screenshot as Qalam AI is sent it: a copy no longer than `side`, as base64. */
async function imageOf(store: OrgStore, deps: SeenDeps, ref: string, side: number, format: "png" | "jpeg"): Promise<ShotImage | null> {
  const a = store.getAsset(hashOf(ref));
  if (!a || !IMAGE.test(a.type)) return null;
  const copy = await deps.prep(hashOf(ref), a.file, side, format).catch(() => ({ file: a.file, type: a.type }));
  if (!IMAGE.test(copy.type)) return null;
  return { mediaType: copy.type as ShotImage["mediaType"], data: (await readFile(copy.file)).toString("base64") };
}

function fresh(key: string, product: string | null): SeenReading {
  return { key, product, started: Date.now(), phase: "reading", shots: [], notes: {}, words: false, rounds: [], steps: {}, settled: { flows: {}, steps: {} } };
}

/**
 * Start reading screenshots for a product (or add them to the reading under way). Each must be an
 * image the organization keeps; one a person took out of the map before comes back only this way.
 * Answers at once; the reading goes on in the core.
 */
export async function startReading(store: OrgStore, key: string, shots: Shot[], opts: { tab?: string; deps?: SeenDeps } = {}): Promise<SeenReading> {
  const product = await productOf(store, key);
  const deps = opts.deps ?? depsFor(store);
  const valid = shots.filter((s) => {
    const a = /^asset:[0-9a-f]{24}$/.test(s.ref) ? store.getAsset(hashOf(s.ref)) : null;
    return a && IMAGE.test(a.type);
  });
  if (!valid.length) throw new Error("None of these is a screenshot Qalam keeps (PNG, JPEG, WebP or GIF).");
  if (running.has(`${store.dir}|${key}`)) throw new Error("Qalam AI is still reading the last screenshots; add these when it asks or is done.");
  const r = await store.changeReading(
    key,
    (was) => {
      const base = !was || was.phase === "done" || was.phase === "failed" ? fresh(key, product) : was;
      const have = new Set(base.shots.map((s) => s.ref));
      const add = valid.filter((s) => !have.has(s.ref)).slice(0, SEEN_LIMITS.shots - base.shots.length);
      return { ...base, phase: "reading", shots: [...base.shots, ...add], activity: "Starting", error: undefined };
    },
    opts,
  );
  // Out of the map no more: a screenshot added again is the person's choice.
  await store.changeSeen(key, (m) => (m && m.gone.some((g) => valid.some((s) => s.ref === g)) ? { ...m, gone: m.gone.filter((g) => !valid.some((s) => s.ref === g)) } : m), opts);
  // What it does from here is announced to every window, its own too (no tab).
  void run(store, key, deps, {});
  return r!;
}

/** The person's answers to the last round; the next round goes on in the core. `skip` stops asking and shows what's proposed. */
export async function answerReading(store: OrgStore, key: string, answers: SeenAnswer[], opts: { tab?: string; skip?: boolean; deps?: SeenDeps } = {}): Promise<SeenReading> {
  await productOf(store, key);
  const r = await store.changeReading(
    key,
    (was) => {
      if (!was || was.phase !== "asking") throw new Error("Nothing is waiting for an answer.");
      const rounds = [...was.rounds];
      const last = rounds[rounds.length - 1];
      const asked = new Map(last.questions.map((q) => [q.id, q]));
      const kept = answers.flatMap((a) => {
        const q = asked.get(a.question);
        return q && a.answer.trim() ? [{ question: q.id, ask: q.ask, answer: a.answer.trim().slice(0, 300), ...(q.about ? { about: q.about } : {}) }] : [];
      });
      rounds[rounds.length - 1] = { ...last, answers: kept };
      return { ...was, rounds, phase: opts.skip ? "review" : "placing", activity: opts.skip ? undefined : "Reading your answers" };
    },
    opts,
  );
  if (!opts.skip) void run(store, key, opts.deps ?? depsFor(store), {});
  return r!;
}

/** What a reading does next, until it waits on the person: read what isn't read, then place. */
async function run(store: OrgStore, key: string, deps: SeenDeps, opts: { tab?: string }) {
  const id = `${store.dir}|${key}`;
  if (running.has(id)) return;
  running.add(id);
  const set = (fn: (r: SeenReading) => SeenReading) => store.changeReading(key, (r) => (r ? fn(r) : r), opts);
  try {
    let r = await store.getReading(key);
    if (!r) return;
    const words = await deps.available().catch(() => false);
    const unread = r.shots.filter((s) => !r!.notes[s.ref]);
    if (unread.length) {
      await set((x) => ({ ...x, phase: "reading", words, activity: words ? `Reading the words on ${unread.length === 1 ? "a screenshot" : `${unread.length} screenshots`}` : "Reading the screenshots" }));
      const texts = await wordsFor(store, deps, unread.map((s) => s.ref));
      const batches: Shot[][] = [];
      for (let k = 0; k < unread.length; k += SEEN_LIMITS.batch) batches.push(unread.slice(k, k + SEEN_LIMITS.batch));
      let done = 0;
      // Two batches at a time.
      for (let k = 0; k < batches.length; k += 2) {
        await set((x) => ({ ...x, activity: `Qalam AI is reading screenshots ${done + 1}–${Math.min(done + batches.slice(k, k + 2).flat().length, unread.length)} of ${unread.length}` }));
        const notes = await Promise.all(batches.slice(k, k + 2).map((b) => readBatch(store, deps, b, texts)));
        done += batches.slice(k, k + 2).flat().length;
        await set((x) => ({ ...x, notes: { ...x.notes, ...Object.assign({}, ...notes) } }));
      }
    }
    r = (await store.getReading(key))!;
    await placeRound(store, key, deps, r, opts);
  } catch (e) {
    await set((x) => ({ ...x, phase: "failed", activity: undefined, error: e instanceof Error ? e.message : String(e) })).catch(() => {});
  } finally {
    running.delete(id);
  }
}

/** One batch's read: what code keeps, by screenshot. */
async function readBatch(store: OrgStore, deps: SeenDeps, batch: Shot[], texts: Map<string, SeenText | undefined>): Promise<Record<string, ShotNote>> {
  const m = readMaterial(batch, texts);
  const images = new Map<string, ShotImage>();
  for (const s of batch) {
    const im = await imageOf(store, deps, s.ref, READ_SIDE, "png");
    if (im) images.set(s.ref, im);
  }
  const { data, model } = await deps.ask(readCall(m, images));
  const dropped: { why: string; item: unknown }[] = [];
  const notes = sanitizeRead(data, m, (why, item) => dropped.push({ why, item }));
  await store
    .putTrace({ id: nanoid(10), projectId: "seen", kind: "seen-read", at: Date.now(), ...(model ? { model } : {}), shots: [...m.shots].map(([id, s]) => ({ id, ref: s.ref, words: !!s.text })), answer: data, kept: notes.size, dropped } as { id: string; projectId: string })
    .catch(() => {});
  return Object.fromEntries(notes);
}

/** A round of placing: the map as it would be, and what's asked next (or nothing, and it's ready to settle). */
async function placeRound(store: OrgStore, key: string, deps: SeenDeps, r: SeenReading, opts: { tab?: string }) {
  await store.changeReading(key, (x) => (x ? { ...x, phase: "placing", activity: `Placing ${r.shots.length === 1 ? "the screen" : `${r.shots.length} screenshots`} in flows` } : x), opts);
  const before = await store.getSeen(key);
  const gone = new Set(before?.gone ?? []);
  const shots = r.shots.filter((s) => !gone.has(s.ref));
  const keptShots = (before?.screens ?? []).flatMap((s) => s.shots);
  const texts = await wordsFor(store, deps, [...shots.map((s) => s.ref), ...keptShots]);
  const products = await store.listProducts();
  const tree = await store.getGoals();
  const product = products.find((p) => p.id === r.product);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const context = [product ? contextText(product, `The product (${product.name}):`) : "", contextText(await store.getAbout(), "The organization:"), goalsText(tree, { product: r.product, productName: (x) => names.get(x) })].filter(Boolean).join("\n\n");
  const goals = tree.goals.filter((g) => g.status === "active" && (!r.product || !g.product || g.product === r.product)).slice(0, 30);
  const code = (await store.listMaps()).filter((m) => !r.product || !m.product || m.product === r.product).flatMap((m) => m.flows.flatMap((f) => f.steps.map((s) => ({ flow: f.name, ref: stepRef(m.key, s.key), step: s }))));
  const answers = r.rounds.flatMap((x) => x.answers);
  const m = placeMaterial({ context, before, shots, notes: r.notes, texts, goals: goals.map((g) => ({ id: g.id, title: g.title })), code, answers });
  const thumbs = new Map<string, ShotImage>();
  for (const t of m.thumbs) {
    const im = await imageOf(store, deps, t.ref, THUMB_SIDE, "jpeg");
    if (im) thumbs.set(t.ref, im);
  }
  const last = r.rounds.length + 1 >= SEEN_LIMITS.rounds;
  const { data, model } = await deps.ask(placeCall(m, thumbs));
  const dropped: { why: string; item: unknown }[] = [];
  const kept = sanitizePlace(data, m, { answers, last }, (why, item) => dropped.push({ why, item }));
  const { map, steps } = proposalOf(before, kept, { key, product: r.product, notes: r.notes, shots, now: Date.now() });
  await store
    .putTrace({ id: nanoid(10), projectId: "seen", kind: "seen-place", at: Date.now(), ...(model ? { model } : {}), key, nodes: [...m.nodes].map(([id, n]) => ({ id, ref: n.ref })), answers, answer: data, kept: { flows: kept.flows.length, questions: kept.questions.length, groups: kept.groups.filter((g) => g.length > 1).length }, dropped } as { id: string; projectId: string })
    .catch(() => {});
  await store.changeReading(
    key,
    (x) =>
      x
        ? {
            ...x,
            phase: kept.questions.length ? "asking" : "review",
            activity: undefined,
            proposal: map,
            steps,
            rounds: kept.questions.length ? [...x.rounds, { questions: kept.questions, answers: [] }] : x.rounds,
          }
        : x,
    opts,
  );
}

/**
 * The person settles a reading: the flows they accept go in the map (with every screen read, flows
 * or not), the ones they discard don't (a flow kept before stays as it was), and an accepted code
 * step puts the screen's picture at that step of the funnel, unless the step has a picture already.
 */
export async function settleReading(store: OrgStore, key: string, decided: SeenReading["settled"], opts: { tab?: string } = {}): Promise<SeenMap | null> {
  await productOf(store, key);
  const r = await store.getReading(key);
  if (!r?.proposal || (r.phase !== "review" && r.phase !== "asking")) throw new Error("Nothing is waiting to be settled.");
  const proposal = r.proposal;
  const accepted = (k: string) => decided.flows[k] === "accepted";
  let written: SeenMap | null = null;
  await store.changeSeen(
    key,
    (before) => {
      const old = new Map((before?.flows ?? []).map((f) => [f.key, f]));
      const flows = proposal.flows.flatMap((f) => (accepted(f.key) ? [f] : old.has(f.key) ? [old.get(f.key)!] : []));
      // A flow kept before that the proposal doesn't have stays.
      for (const f of before?.flows ?? []) if (!flows.some((x) => x.key === f.key)) flows.push(f);
      const stepFor = (s: SeenScreen) => (decided.steps[s.key] === "accepted" && r.steps[s.key] ? { step: r.steps[s.key] } : {});
      const screens = proposal.screens.map((s) => ({ ...s, ...stepFor(s) }));
      written = { ...proposal, readAt: Date.now(), screens, flows, gone: before?.gone ?? proposal.gone };
      return written;
    },
    opts,
  );
  // Pictures at code steps: only where the step has none.
  const { pins } = foldPins(await store.listStepLog());
  const pictured = new Set(pins.filter((p) => p.what === "picture").map((p) => p.step));
  const entries = Object.entries(r.steps)
    .filter(([screen, step]) => decided.steps[screen] === "accepted" && !pictured.has(step))
    .flatMap(([screen, step]) => {
      const s = proposal.screens.find((x) => x.key === screen);
      return s ? [{ step, what: "picture" as const, id: s.shots[0], by: "you" as const, at: Date.now() }] : [];
    });
  if (entries.length) await store.addStepPins(entries, opts);
  await store.changeReading(key, (x) => (x ? { ...x, phase: "done", settled: decided, activity: undefined } : x), opts);
  return written;
}

/** Drop a reading (its screenshots stay as assets; nothing is written to the map). */
export async function dropReading(store: OrgStore, key: string, opts: { tab?: string } = {}): Promise<void> {
  await productOf(store, key);
  if (running.has(`${store.dir}|${key}`)) throw new Error("Qalam AI is still reading; wait for it to ask or finish.");
  await store.changeReading(key, () => null, opts);
}

/** A person's change to the map: their words on a screen or a flow, a screen or flow taken out, a code step said or unsaid. */
export type SeenEdit =
  | { screen: string; name?: string; does?: string; on?: string; design?: string; state?: { shot: string; text: string } }
  | { removeScreen: string }
  | { flow: string; name?: string; aim?: string; note?: string; notShown?: string[] }
  | { removeFlow: string };

const words = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined);

/** A person's edit, shaped, or null. */
export function seenEditShape(raw: unknown): SeenEdit | null {
  const e = raw as Record<string, unknown> | null;
  const key = (v: unknown) => typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v);
  if (!e || typeof e !== "object") return null;
  if (key(e.removeScreen)) return { removeScreen: e.removeScreen as string };
  if (key(e.removeFlow)) return { removeFlow: e.removeFlow as string };
  if (key(e.screen)) {
    const st = e.state as Record<string, unknown> | undefined;
    return { screen: e.screen as string, ...(words(e.name, 60) ? { name: words(e.name, 60) } : {}), ...(e.does !== undefined ? { does: words(e.does, 400) ?? "" } : {}), ...(e.on !== undefined ? { on: words(e.on, 400) ?? "" } : {}), ...(e.design !== undefined ? { design: words(e.design, 400) ?? "" } : {}), ...(st && typeof st.shot === "string" ? { state: { shot: st.shot, text: words(st.text, 200) ?? "" } } : {}) };
  }
  if (key(e.flow)) return { flow: e.flow as string, ...(words(e.name, 80) ? { name: words(e.name, 80) } : {}), ...(e.aim !== undefined ? { aim: words(e.aim, 120) ?? "" } : {}), ...(e.note !== undefined ? { note: words(e.note, 400) ?? "" } : {}), ...(Array.isArray(e.notShown) ? { notShown: e.notShown.map((n) => words(n, 200)).filter((n): n is string => !!n).slice(0, SEEN_LIMITS.notShown) } : {}) };
  return null;
}

const optional = (k: "does" | "on" | "design" | "note", v: string | undefined) => (v === undefined ? {} : v ? { [k]: v } : { [k]: undefined });

export async function editSeen(store: OrgStore, key: string, e: SeenEdit, opts: { tab?: string } = {}): Promise<SeenMap | null> {
  await productOf(store, key);
  return store.changeSeen(
    key,
    (m) => {
      if (!m) throw new NotFoundError("No screens here yet");
      const now = Date.now();
      if ("removeScreen" in e) {
        const s = m.screens.find((x) => x.key === e.removeScreen);
        if (!s) throw new NotFoundError("No such screen");
        const flows = m.flows
          .map((f) => ({ ...f, steps: f.steps.filter((x) => x !== s.key).filter((x, k, a) => x !== a[k - 1]), moves: f.moves.filter((mv) => mv.from !== s.key && mv.to !== s.key) }))
          .filter((f) => new Set(f.steps).size >= 2);
        return { ...m, screens: m.screens.filter((x) => x !== s), flows, gone: [...new Set([...m.gone, ...s.shots])] };
      }
      if ("removeFlow" in e) {
        if (!m.flows.some((f) => f.key === e.removeFlow)) throw new NotFoundError("No such flow");
        return { ...m, flows: m.flows.filter((f) => f.key !== e.removeFlow), gone: [...new Set([...m.gone, `flow:${e.removeFlow}`])] };
      }
      if ("screen" in e) {
        const at = m.screens.findIndex((x) => x.key === e.screen);
        if (at < 0) throw new NotFoundError("No such screen");
        const s = m.screens[at];
        const states = e.state && s.shots.includes(e.state.shot) ? { ...s.states, [e.state.shot]: e.state.text } : s.states;
        const next: SeenScreen = { ...s, ...(e.name ? { name: e.name } : {}), ...optional("does", e.does), ...optional("on", e.on), ...optional("design", e.design), states: Object.fromEntries(Object.entries(states).filter(([, v]) => v)), by: "you", at: now };
        return { ...m, screens: m.screens.map((x, k) => (k === at ? next : x)) };
      }
      const at = m.flows.findIndex((f) => f.key === e.flow);
      if (at < 0) throw new NotFoundError("No such flow");
      const f = m.flows[at];
      return { ...m, flows: m.flows.map((x, k) => (k === at ? { ...f, ...(e.name ? { name: e.name } : {}), ...(e.aim !== undefined ? { aim: e.aim } : {}), ...optional("note", e.note), ...(e.notShown ? { notShown: e.notShown } : {}), by: "you" as const, at: now } : x)) };
    },
    opts,
  );
}

/** What the window shows: a product's map and its reading, with which screenshots this Mac read. */
export async function seenView(store: OrgStore, key: string): Promise<{ map: SeenMap | null; reading: SeenReading | null; words: boolean }> {
  await productOf(store, key);
  const [map, reading, words] = await Promise.all([store.getSeen(key), store.getReading(key), seeAvailable().catch(() => false)]);
  return { map, reading, words };
}

/** Every product's map, for Evidence and the goal page. */
export async function seenMaps(store: OrgStore): Promise<SeenMap[]> {
  return store.listSeen();
}
