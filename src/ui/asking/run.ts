import { applyTurn, askInstead, awaitsConfirm, closeRound, confirmed, currentRound, endNow, lookupLanded, markRead, nextAfter, offPoint, saveRound, startLookup, takePicks, waitedOn } from "@/asking/engine";
import type { AskTurn, AskingState, FoundLine, Lookup } from "@/asking/types";
import type { FocusLook } from "@/goals/focus";
import { orgContext } from "@/org/pack";
import type { FlowState } from "@/ui/ai/questionFlow";

/*
 * The interview from a window, for any flow that generates (src/asking/): Qalam AI's turns, the lookups
 * it asks for (each running on its own while the person answers), the rounds in the box, and the end.
 * A flow gives a host: where its state lives, its turn call, how it looks things up, and what it
 * generates. One turn runs at a time per host; nothing retries on its own.
 */

export interface AskingHost {
  /** One conversation per key (a chat turn's id). */
  key: string;
  get(): AskingState | null;
  set(fn: (s: AskingState) => AskingState): void;
  /** Qalam AI's turn, as the core kept it. */
  turn(s: AskingState, signal: AbortSignal): Promise<AskTurn>;
  /** A fact looked up (each lookup has its own signal: it runs on while they answer). */
  lookup(l: Lookup, signal: AbortSignal): Promise<{ lines?: FoundLine[]; look?: FocusLook }>;
  /** It ended and they said go, or nothing needed asking: the generation. */
  generate(s: AskingState, signal: AbortSignal): Promise<void>;
  /** What it's doing now, for the thread. */
  status?(s: "thinking" | "looking"): void;
}

/** Why the conversation paused: a round or a lookup put to them, What we settled, or it generated. */
export type Paused = "ask" | "offer" | "settled" | "generated";

const lookups = new Map<string, { promise: Promise<void>; ctrl: AbortController }>();
let made = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(made++).toString(36)}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const until = (signal: AbortSignal) => new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));

/** Every lookup the state has running that nothing here runs yet: started now, each with its own signal. */
export function startLookups(h: AskingHost) {
  for (const l of h.get()?.lookups ?? []) {
    const k = `${h.key}:${l.id}`;
    if (l.state !== "running" || lookups.has(k)) continue;
    const ctrl = new AbortController();
    const promise = h
      .lookup(l, ctrl.signal)
      .then(
        (r) => h.set((s) => lookupLanded(s, l.id, r)),
        (e: unknown) => h.set((s) => lookupLanded(s, l.id, ctrl.signal.aborted ? { stopped: true } : { error: message(e) })),
      )
      .finally(() => lookups.delete(k));
    lookups.set(k, { promise, ctrl });
  }
}

/** Stop one lookup: what waited on it is asked again without it. */
export const stopLookup = (key: string, id: string) => lookups.get(`${key}:${id}`)?.ctrl.abort();

/** Stop every lookup of a conversation (Stop, or the turn going away). */
export function stopLookups(key: string) {
  for (const [k, l] of lookups) if (k.startsWith(`${key}:`)) l.ctrl.abort();
}

/** On from wherever it is: turns and lookups until a round shows, a lookup is put to them, What we settled waits, or it has generated. */
export async function goOn(h: AskingHost, signal: AbortSignal): Promise<Paused> {
  for (;;) {
    startLookups(h);
    const s = h.get();
    if (!s) return "generated";
    const next = nextAfter(s);
    if (next === "ask" || next === "offer") return next;
    if (next === "end") {
      if (awaitsConfirm(s)) return "settled";
      await h.generate(s, signal);
      return "generated";
    }
    if (next === "wait") {
      h.status?.("looking");
      const waits = waitedOn(s).map((l) => lookups.get(`${h.key}:${l.id}`)?.promise);
      // A lookup the state says runs, that nothing here runs: it stopped (a reload), so nothing waits on it.
      const lost = waitedOn(s).filter((_, i) => !waits[i]);
      if (lost.length) h.set((x) => lost.reduce((y, l) => lookupLanded(y, l.id, { stopped: true }), x));
      await Promise.race([Promise.all(waits.filter(Boolean)), until(signal)]);
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      continue;
    }
    h.status?.("thinking");
    h.set(markRead);
    const t = await h.turn(h.get()!, signal);
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    h.set((x) => applyTurn(x, t, { now: Date.now(), id: newId }));
  }
}

/** A round's answers kept as they're given. */
export const keepRound = (h: AskingHost, form: FlowState) => h.set((s) => saveRound(s, form));

/** A round sent: on to what comes next. */
export function answer(h: AskingHost, form: FlowState, signal: AbortSignal): Promise<Paused> {
  h.set((s) => closeRound(s, form));
  return goOn(h, signal);
}

/** "Use Qalam AI's picks": what they haven't answered takes its recommendation, marked as Qalam AI's, and the round goes. */
export function picks(h: AskingHost, form: FlowState, signal: AbortSignal): Promise<Paused> {
  const r = h.get() && currentRound(h.get()!);
  return answer(h, r ? takePicks(r.questions, form) : form, signal);
}

/** "Stop asking": what's answered stands, and What we settled shows (or it generates, if nothing was asked). */
export function stopAsking(h: AskingHost, form: FlowState | null, signal: AbortSignal): Promise<Paused> {
  if (form) h.set((s) => saveRound(s, form));
  h.set((s) => endNow(s, Date.now()));
  for (const l of h.get()?.lookups ?? []) if (l.state === "stopped") stopLookup(h.key, l.id);
  return goOn(h, signal);
}

/** They saw what was settled and said go. */
export function confirm(h: AskingHost, signal: AbortSignal): Promise<Paused> {
  h.set((s) => confirmed(s, Date.now()));
  return goOn(h, signal);
}

/** "Something's off": a round asks what. */
export const off = (h: AskingHost) => h.set(offPoint);

/** The lookup put to them: yes, look it up; or ask me instead. */
export function lookItUp(h: AskingHost, signal: AbortSignal): Promise<Paused> {
  const s = h.get();
  if (s?.offer) h.set((x) => startLookup(x, { id: s.offer!.id, kind: "web", query: s.offer!.query, waits: x.turns }, Date.now()));
  return goOn(h, signal);
}

export function askMeInstead(h: AskingHost, signal: AbortSignal): Promise<Paused> {
  h.set(askInstead);
  return goOn(h, signal);
}

// ---------------------------------------------------------------------------
// A lookup in their project: the organization's search, no tokens

const WHOSE: Record<string, string> = { said: "people said", measured: "measured", studied: "studied", read: "read elsewhere", own: "the team's" };

/** What their project has on a query: its quotes, each with whose words they are. */
export async function projectLookup(l: Pick<Lookup, "id" | "query">, o: { product?: string | null } = {}): Promise<{ lines: FoundLine[] }> {
  const pack = await orgContext({ query: l.query, budget: 900, types: ["quote"], ...(o.product !== undefined ? { product: o.product } : {}) });
  const lines = (pack?.pieces ?? []).slice(0, 8).map((p, i): FoundLine => {
    // A quote piece's sub says whose words it holds: online:…, dump:… (the team's), measured:…, or bare (people said).
    const sub = p.sub ?? "";
    const whose = sub.startsWith("online:") ? "people online" : sub.startsWith("dump:") ? "the team's" : (WHOSE[sub.split(":")[0]] ?? "people said");
    return { ref: `${l.id}-${i + 1}`, text: p.text, from: p.title ?? "a source", whose, piece: p.ref };
  });
  return { lines };
}
