import { z } from "zod";
import type { Terms } from "@/terms/types";
import { clashes } from "@/terms/fold";
import { answersOf, theirWords } from "./engine";
import type { TurnCheck } from "./sanitize";
import type { AskingState, LookupKind } from "./types";

/*
 * The interview as a route receives it and the model reads it (pure). Every round goes, however many
 * there are: the latest two whole, older ones a line per answer, so a long interview still fits. The
 * one guard is on size, never on count.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** How big the conversation may be in one request: a guard on size, not on how many rounds. */
export const ASKING_MAX_CHARS = 60_000;

const Answer = z.object({ id: z.string().max(80), title: z.string().max(400), answer: z.string().max(1600), how: z.enum(["own", "pick", "left"]) });
const Line = z.object({ ref: z.string().max(40), text: z.string().max(800), from: z.string().max(300), whose: z.string().max(60).optional() });

export const AskingIn = z
  .object({
    rounds: z.array(z.object({ by: z.literal("code").optional(), asked: z.array(Answer) })),
    lookups: z.array(z.object({ id: z.string().max(40), kind: z.enum(["project", "web"]), query: z.string().max(400), state: z.enum(["running", "done", "failed", "stopped"]), lines: z.array(Line) })),
    held: z.array(z.object({ id: z.string().max(80), title: z.string().max(400), after: z.array(z.string().max(80)) })),
    understood: z.array(z.string().max(400)),
    proposed: z.array(z.string().max(80)),
    clashes: z.array(z.object({ word: z.string().max(80), term: z.string().max(80) })).optional(),
    said: z.string().max(8000),
    askFirst: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (JSON.stringify(v).length > ASKING_MAX_CHARS) ctx.addIssue({ code: "custom", message: "The conversation is too long to send at once" });
  });
export type AskingInT = z.infer<typeof AskingIn>;

/** What a route is sent about the interview so far. `said`: their own words in what they asked (their answers are added). */
export function askingIn(s: AskingState, o: { said: string; terms?: Terms }): AskingInT {
  const answers = answersOf(s);
  const last = s.rounds.length - 2;
  const rounds = s.rounds.map((r, i) => ({
    ...(r.questions.every((q) => q.by === "code") ? { by: "code" as const } : {}),
    asked: answers
      .filter((a) => a.round === i)
      .map((a) => ({ id: a.id, title: clip(one(a.question), 300), answer: clip(one(a.text), i >= last ? 1500 : 200), how: a.how })),
  }));
  const said = [one(o.said), theirWords(s)].filter(Boolean).join("\n");
  const out: AskingInT = {
    rounds,
    lookups: s.lookups
      .filter((l) => l.waits !== "draft")
      .map((l) => ({ id: l.id, kind: l.kind, query: clip(one(l.query), 300), state: l.state, lines: (l.lines ?? []).slice(0, 8).map((x) => ({ ref: x.ref, text: clip(one(x.text), 600), from: clip(one(x.from), 200), ...(x.whose ? { whose: x.whose } : {}) })) })),
    held: s.held.map((q) => ({ id: q.id, title: clip(one(q.title), 300), after: q.after ?? [] })),
    understood: s.understood.map((p) => clip(p.text, 300)),
    proposed: s.terms.map((t) => t.term),
    ...(o.terms ? { clashes: clashes(o.terms, said).slice(0, 8) } : {}),
    said: clip(said, 7000),
    ...(s.askFirst ? { askFirst: true } : {}),
  };
  // Over the size: older answers shorter, then fewer lines a lookup, until it fits.
  for (const cut of [120, 60, 30]) {
    if (JSON.stringify(out).length <= ASKING_MAX_CHARS) break;
    out.rounds = out.rounds.map((r, i) => (i >= last ? r : { ...r, asked: r.asked.map((a) => ({ ...a, answer: clip(a.answer, cut) })) }));
    out.lookups = out.lookups.map((l) => ({ ...l, lines: l.lines.slice(0, Math.max(2, Math.floor(cut / 20))) }));
  }
  return out;
}

const KIND_WORD: Record<LookupKind, string> = { project: "their project", web: "the web" };

const answerLine = (a: AskingInT["rounds"][number]["asked"][number]) =>
  `- ${a.id} · ${a.title} → ${a.how === "own" ? `“${a.answer}”` : a.how === "pick" ? `your recommendation, which they agreed to with one press: “${a.answer}” (agreement, not their words)` : "left unanswered: they don't know or won't say; don't assume an answer, and don't ask it again"}`;

/** The conversation so far as the model reads it, ids shown so a question can say what it waits on. */
export function askingBlock(a: AskingInT): string {
  const out: string[] = [];
  if (a.rounds.length) {
    out.push("Asked so far, round by round (id · question → their answer):");
    a.rounds.forEach((r, i) => out.push(`Round ${i + 1}${r.by ? " (code's own questions)" : ""}:`, ...(r.asked.length ? r.asked.map(answerLine) : ["- (nothing answered)"])));
  } else out.push("Nothing asked yet.");
  if (a.lookups.length) {
    out.push("", "Looked up (id · where · what · what it found; found lines by their own ids):");
    for (const l of a.lookups) {
      const head = `- ${l.id} · ${KIND_WORD[l.kind]} · “${l.query || "what people do about this"}”`;
      if (l.state === "running") out.push(`${head}: still running`);
      else if (l.state !== "done") out.push(`${head}: ${l.state === "failed" ? "it failed" : "stopped"}, nothing came of it`);
      else if (!l.lines.length) out.push(`${head}: nothing found`);
      else out.push(`${head}:`, ...l.lines.map((x) => `  - ${x.ref} · “${x.text}” · ${x.from}${x.whose ? ` (${x.whose})` : ""}`));
    }
  }
  if (a.held.length) out.push("", "Waiting on something still open, not asked yet (ask again once it settles, if it still matters):", ...a.held.map((q) => `- ${q.id} · ${q.title} (after ${q.after.join(", ")})`));
  if (a.understood.length) out.push("", "What you took as settled last turn:", ...a.understood.map((p) => `- ${p}`));
  if (a.clashes?.length) out.push("", "Words they used that the project's words say to avoid (ask which they mean, unless it's plain):", ...a.clashes.map((x) => `- “${x.word}”: the project says “${x.term}”`));
  if (a.proposed.length) out.push("", `Terms offered already in this conversation (never again): ${a.proposed.map((t) => `“${t}”`).join(", ")}`);
  if (a.askFirst) out.push("", "They'd rather be asked than have more looked up: ask, or say done. No lookups this turn.");
  return out.join("\n");
}

/** What code checks a turn against, from what the route was sent. */
export function checkOf(a: AskingInT, o: Omit<TurnCheck, "asked" | "lookups" | "said" | "proposed"> & { hay: string }): TurnCheck {
  return {
    ...o,
    asked: [...a.rounds.flatMap((r) => r.asked.map((x) => ({ id: x.id, title: x.title }))), ...a.held.map((q) => ({ id: q.id, title: q.title }))],
    lookups: a.lookups.map((l) => ({ id: l.id, kind: l.kind, query: l.query })),
    said: a.said,
    proposed: a.proposed,
    kinds: a.askFirst ? [] : o.kinds,
  };
}
