import { z } from "zod";
import { foldAsked, linesFor } from "@/memory/fold";
import { ASKED_FLOWS, sharedHow, type AskedAbout, type AskedFlow, type AskedHow, type AskedForget, type Who } from "@/memory/types";
import { whoAmI } from "../settings";
import type { OrgStore } from "./store";

/**
 * Qalam AI's memory of what it asked, in the core (src/memory/ is the pure part): a round's answers
 * remembered as they're given, a line forgotten, and the list people read in the Company panel. Their own
 * answers and the picks they agreed to are the team's (hub/asked.jsonl, with who said them); what they
 * didn't know or left stays on this computer (.qalam/local/asked.jsonl).
 */

const id = z.string().max(120).optional();

export const RememberBody = z.object({
  flow: z.enum(ASKED_FLOWS as [AskedFlow, ...AskedFlow[]]),
  key: z.string().min(1).max(160),
  about: z.object({ product: z.string().max(120).nullable(), board: id, card: id, goal: id, topic: id, source: id }),
  answers: z
    .array(z.object({ qid: z.string().min(1).max(80), q: z.string().max(400), a: z.string().max(1600), how: z.enum(["own", "pick", "unknown", "left"]), code: z.literal(true).optional() }))
    .max(80),
});
export type RememberBodyT = z.infer<typeof RememberBody>;

/** A round's answers remembered; what's remembered already as it is isn't written again. How many lines were written. */
export async function rememberRound(store: OrgStore, b: RememberBodyT, opts: { tab?: string; who?: Who; now?: number } = {}): Promise<number> {
  const by = opts.who ?? (await whoAmI());
  const about = Object.fromEntries(Object.entries(b.about).filter(([, v]) => v !== undefined)) as unknown as AskedAbout;
  const lines = linesFor({ flow: b.flow, key: b.key, about, answers: b.answers, by, at: opts.now ?? Date.now(), have: foldAsked(await store.listAsked()) });
  await store.addAsked(lines, opts);
  return lines.shared.length + lines.local.length;
}

/** A line taken off: Qalam AI won't bring it up when it asks. The tombstone goes where the line lives. */
export async function forgetAsked(store: OrgStore, entry: string, opts: { tab?: string; who?: Who; now?: number } = {}): Promise<boolean> {
  const e = foldAsked(await store.listAsked()).entries.find((x) => x.id === entry);
  if (!e) return false;
  const line: AskedForget = { v: 1, forget: entry, at: opts.now ?? Date.now(), by: opts.who ?? (await whoAmI()) };
  await store.addAsked(sharedHow(e.how) ? { shared: [line], local: [] } : { shared: [], local: [line] }, opts);
  return true;
}

/** A remembered answer as people read it: whose (theirs, or a teammate's by name where they gave one), where and when, and whether the team sees it. */
export interface MemoryLine {
  id: string;
  at: number;
  flow: AskedFlow;
  q: string;
  a: string;
  how: AskedHow;
  mine: boolean;
  name?: string;
  shared: boolean;
  about: AskedAbout;
}

export async function listMemory(store: OrgStore, o: { who?: Who } = {}): Promise<{ entries: MemoryLine[] }> {
  const me = o.who ?? (await whoAmI());
  const { entries } = foldAsked(await store.listAsked());
  return {
    entries: entries.map((e) => {
      const mine = e.by.id === me.id;
      return { id: e.id, at: e.at, flow: e.flow, q: e.q, a: e.a, how: e.how, mine, ...(!mine && e.by.name ? { name: e.by.name } : {}), shared: sharedHow(e.how), about: e.about };
    }),
  };
}
