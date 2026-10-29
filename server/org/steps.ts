import { nanoid } from "nanoid";
import { stepsCall } from "@/ai/steps";
import { structured } from "@/ai/server";
import { funnelOf, stepRef, type MapFlow } from "@/code/map";
import { foldPins, pinKey, sanitizeSteps, stepMaterial, STEP_LIMITS, type StepPin, type StepPinLog, type StepQuote, type StepView } from "@/code/steps";
import { foldBearings } from "@/goals/bearings";
import { rankForGoal } from "@/goals/problems";
import { goalById } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import { rankNeeds } from "@/hub/needs";
import { indexFor } from "../index/registry";
import { search } from "../index/search";
import { DISCOVERY_MODEL } from "../routes/discovery";
import { figmaPicture } from "../connectors/figma";
import { assetHash } from "./fsx";
import { knowledgeInputs } from "./needs";
import { NotFoundError, type OrgStore } from "./store";

/**
 * What sits at the steps of a goal's funnel, in the core (src/code/steps.ts): the pins a person
 * makes and takes off, and one call placing what customers said at the steps. That call reads the
 * quotes the goal's problems rest on first, then the ones search finds near the steps' words.
 */

/** The pins at a funnel's steps, with each pinned quote's words (none without the index here). */
export async function stepView(store: OrgStore, map: string, flow: MapFlow): Promise<StepView> {
  const refs = new Set(flow.steps.map((s) => stepRef(map, s.key)));
  const pins = foldPins(await store.listStepLog()).pins.filter((p) => refs.has(p.step));
  const quotes: StepView["quotes"] = {};
  try {
    const rows = indexFor(store).piecesByRef(pins.filter((p) => p.what === "quote").map((p) => p.id));
    for (const [ref, r] of rows) quotes[ref] = { text: r.text, ...(whoOf(r) ? { who: whoOf(r) } : {}) };
  } catch {
    // No index here: the quotes show by their words at the step only.
  }
  return { pins, quotes };
}

const whoOf = (r: { speaker: string | null; title: string | null }) => [r.speaker, r.title].filter(Boolean).join(", ") || undefined;

/** Customers' quotes for a goal's steps: the ones its problems' pages cite first, then the ones search finds near the steps. */
async function quotesFor(store: OrgStore, goal: Goal, flow: MapFlow): Promise<StepQuote[]> {
  const k = await knowledgeInputs(store);
  if (!k.indexed) return [];
  const ix = indexFor(store);
  const tree = await store.getGoals();
  const problems = rankForGoal(goal.id, { tree, links: foldBearings(await store.listBearingLog()).links, needs: rankNeeds({ now: Date.now(), topics: k.topics, pieces: k.pieces, shows: k.shows }) });
  const pages = new Map(k.topics.map((t) => [t.id, t]));
  const cited = problems.flatMap((p) => pages.get(p.topic)?.lines.flatMap((l) => (l.section === "against" ? [] : l.cites)) ?? []).filter((r) => r.startsWith("hub:quote:"));
  const query = [goal.title, ...flow.steps.map((s) => s.title)].join("; ").slice(0, 600);
  const { hits } = await search(ix, { query, limit: 200, use: { links: false }, ...(goal.product ? { product: goal.product } : {}) });
  const refs = [...new Set([...cited, ...hits.filter((h) => h.type === "quote").map((h) => h.ref)])];
  const rows = ix.piecesByRef(refs);
  return refs
    .flatMap((ref): StepQuote[] => {
      const r = rows.get(ref);
      // A customer's words only: a brain dump's pieces are the team's.
      if (!r || r.type !== "quote" || r.sub?.startsWith("dump:")) return [];
      const who = whoOf(r);
      return [{ ref, text: r.text, ...(who ? { who } : {}) }];
    })
    .slice(0, STEP_LIMITS.quotes);
}

export interface Placed {
  /** Quotes newly placed at a step. */
  added: number;
  /** Quotes Qalam AI stands behind now (new or kept). */
  kept: number;
  /** Its earlier places it took back. */
  removed: number;
  /** Quotes it read. */
  read: number;
}

/** One call placing customers' quotes at a goal's steps; Qalam AI's earlier places it doesn't make again are taken off. */
export async function placeQuotes(store: OrgStore, goalId: string, emit?: (label: string) => void): Promise<Placed> {
  const goal = goalById(await store.getGoals(), goalId);
  if (!goal) throw new NotFoundError("No such goal");
  const funnel = funnelOf(goal, await store.listMaps());
  if (!funnel) throw new Error("This goal has no funnel from the product's code yet: read the code in Connections.");
  emit?.("Finding what customers said near these steps");
  const quotes = await quotesFor(store, goal, funnel.flow);
  if (!quotes.length) return { added: 0, kept: 0, removed: 0, read: 0 };
  const m = stepMaterial({ goal, map: funnel.map.key, flow: funnel.flow, quotes });
  emit?.(`Qalam AI is reading ${quotes.length === 1 ? "a quote" : `${quotes.length} quotes`} against the steps`);
  const { pins, refused } = foldPins(await store.listStepLog());
  const { data, model } = await structured<unknown>({ model: DISCOVERY_MODEL, ...stepsCall(m) });
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const found = sanitizeSteps(data, m, { now, refused }, (why, item) => dropped.push({ why, item }));
  await store
    .putTrace({ id: nanoid(10), projectId: "goals", kind: "steps", at: now, ...(model ? { model } : {}), goal: goalId, steps: [...m.steps].map(([id, s]) => ({ id, ref: s.ref })), quotes: [...m.quotes].map(([id, q]) => ({ id, ref: q.ref })), answer: data, kept: found.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  const steps = new Set([...m.steps.values()].map((s) => s.ref));
  const sent = new Set(quotes.map((q) => q.ref));
  const have = new Map(pins.map((p) => [pinKey(p), p]));
  const entries: StepPinLog[] = found.filter((p) => {
    const was = have.get(pinKey(p));
    return !was || (was.by === "qalam" && was.words !== p.words);
  });
  let removed = 0;
  for (const p of pins)
    if (p.by === "qalam" && p.what === "quote" && steps.has(p.step) && sent.has(p.id) && !found.some((f) => pinKey(f) === pinKey(p))) {
      entries.push({ step: p.step, what: "quote", id: p.id, by: "qalam", removed: true, at: now });
      removed++;
    }
  await store.addStepPins(entries);
  return { added: entries.length - removed, kept: found.length, removed, read: quotes.length };
}

/** A person pins something at a step, or takes it off. A picture must be one the organization keeps. */
export async function pinByHand(store: OrgStore, x: { step: string; what: StepPin["what"]; id: string; on: boolean }, opts: { tab?: string } = {}): Promise<void> {
  if (x.on && x.what === "picture" && !store.getAsset(x.id.replace(/^asset:/, ""))) throw new NotFoundError("That picture isn't here");
  await store.addStepPins([{ step: x.step, what: x.what, id: x.id, by: "you", at: Date.now(), ...(x.on ? {} : { removed: true }) }], opts);
}

/** A step's picture from a frame in Figma: Figma renders it (through the user's Claude Code), the organization keeps it, the step shows it. */
export async function pictureFromFigma(store: OrgStore, step: string, link: string, emit: (label: string) => void, signal: AbortSignal, opts: { tab?: string } = {}): Promise<{ id: string; from: string }> {
  emit("Asking Figma for the frame through Claude Code");
  const got = await figmaPicture(link, { signal });
  const hash = assetHash(got.bytes);
  await store.putAsset(hash, got.bytes, got.type);
  const id = `asset:${hash}`;
  await store.addStepPins([{ step, what: "picture", id, from: got.frame.url, by: "you", at: Date.now() }], opts);
  return { id, from: got.frame.url };
}
