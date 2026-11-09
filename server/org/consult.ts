import { nanoid } from "nanoid";
import { askTurnCall } from "@/ai/asking";
import { consultFields, playbookBlock, situationCall } from "@/ai/consult";
import { sanitizeTurn } from "@/asking/sanitize";
import type { AskTurn, LookupKind } from "@/asking/types";
import { askingBlock, checkOf, type AskingInT } from "@/asking/wire";
import { noteLines } from "@/business/edit";
import { sanitizeNotes } from "@/business/notes";
import { businessText } from "@/business/text";
import type { BusinessLine } from "@/business/types";
import { consultMaterial } from "@/consult/material";
import { PLAYBOOK_IDS, type PlaybookId } from "@/consult/playbooks.gen";
import { consultRound } from "@/consult/round";
import { LEVELS, sanitizeSituation, situationAfter, situationOf, type Level, type Situation } from "@/consult/situation";
import { saysNoIdea } from "@/scan/input";
import { planTweak, type OutlineCard } from "@/space/plan";
import { lookupKinds } from "../connectors/everywhere";
import { labOn } from "../lab";
import { companyContext } from "./company";
import { realDeps, type MarketDeps } from "./market";
import { recallFor, subjectOf, withKnown } from "./memory";
import type { OrgStore } from "./store";

/*
 * Qalam AI as a consultant, in the core (src/consult/): who's asking read from their first words, then
 * each turn of the conversation on the interview (src/asking/), following the playbook for where they
 * came in, paced and worded for how much they know. What an answer says about the business is written
 * to the business page as it comes (business.md), checked against that answer. The window keeps the
 * conversation on its chat turn and sends it with each call; nothing here is kept but traces.
 */

/** What the window sends besides the plan's body: how much they know (theirs, or the read), who's asking, the playbook in use. */
export interface ConsultIn {
  level?: Level;
  situation?: Situation;
  playbook?: PlaybookId;
  /** They asked for fixes as well as the diagnosis. */
  fixes?: true;
}

/** A consultant's turn as code kept it: the interview's, with who's asking, the playbook a turn picked, and the lines it noted. */
export type ConsultTurn = AskTurn & { situation: Situation; picked?: PlaybookId; noted: BusinessLine[] };

/** The consultant's lookups: their own material, the web (and their tools where a look in them can be offered). */
const CONSULT_KINDS = ["project", "web"] as const;

/** Who's asking, from their first words: one small call, and code's own reading when it can't be had. */
export async function readSituation(said: string, signal: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<Situation> {
  const text = said.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!text || saysNoIdea(text)) return { ...situationOf(text), named: false };
  return deps.structured<unknown>(situationCall(text), AbortSignal.any([signal, AbortSignal.timeout(20_000)])).then(
    (r) => sanitizeSituation(r.data, text),
    (e: unknown) => {
      if (signal.aborted) throw e;
      return situationOf(text);
    },
  );
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The consult part of a request, kept to its shape: what isn't one of its lists is left out. */
export function consultInOf(raw: unknown, said: string): ConsultIn {
  const c = rec(raw);
  const level = LEVELS.find((l) => l === c.level);
  const playbook = PLAYBOOK_IDS.find((p) => p === c.playbook);
  // A situation the window kept from the read: kept again to its lists and their words.
  const situation = c.situation && typeof c.situation === "object" ? sanitizeSituation({ ...rec(c.situation), said: rec(c.situation).named === false ? "none" : "named" }, said) : undefined;
  return { ...(level ? { level } : {}), ...(situation ? { situation } : {}), ...(playbook ? { playbook } : {}), ...(c.fixes === true ? { fixes: true as const } : {}) };
}

/**
 * One turn: what's still open, asked the way a consultant would for who's asking. Before any answer
 * nothing is looked up; after, each lookup says why. A first turn that fails asks code's own opening
 * for where they came in; a later one fails for Try again.
 */
export async function consultNext(store: OrgStore, b: { said: string; outline: OutlineCard[]; asking?: AskingInT; consult?: ConsultIn }, emit: (label: string) => void, signal: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<ConsultTurn> {
  const a: AskingInT = b.asking ?? { rounds: [], lookups: [], held: [], understood: [], proposed: [], said: b.said };
  if (!b.consult?.situation) emit("Reading what you wrote");
  const situation = b.consult?.situation ?? (await readSituation(b.said, signal, deps));
  const level = b.consult?.level ?? situation.level;
  const playbook = b.consult?.playbook ?? situation.layer;
  emit("Working out what to ask");
  const answers = a.rounds.flatMap((r) => r.asked);
  const answered = answers.some((x) => x.how !== "left");
  const base = consultMaterial({
    org: store.info.name,
    said: b.said,
    situation,
    level,
    business: businessText(await store.getBusiness(), { org: store.info.name, max: 2000 }),
    company: await companyContext(store, { near: b.said, business: false }),
    outline: b.outline,
    answered,
  });
  // What's already known (src/memory/): other conversations' answers, their material, their best-backed pages, decisions.
  const known = await recallFor(store, a, { flow: "consult", words: [b.said, ...b.outline.map((c) => c.title)].join("\n"), broad: true, sent: base });
  const material = [base, known.block, askingBlock(a)].filter(Boolean).join("\n\n");
  const lab = await labOn();
  const decisions = lab === true || lab.includes("decisions");
  // Reading what people say online, once something's named to read about: offered once a conversation.
  const scan = (situation.named || !!situation.product) && !a.scan;
  const kinds: readonly LookupKind[] = [...(await lookupKinds(CONSULT_KINDS)), ...(scan ? (["scan"] as const) : [])];
  const call = askTurnCall({ flow: "consult", who: "person", material, kinds, terms: true, choices: decisions, teach: true, why: true, reflect: true, playbook: playbookBlock(playbook), extra: consultFields() });
  let answer: { data: unknown; model?: string };
  try {
    answer = await deps.structured<unknown>(call, signal);
  } catch (e) {
    if (signal.aborted || a.rounds.length) throw e;
    // A first turn that can't be taken: code's own opening for where they came in, so they're still asked.
    return { questions: consultRound(situation.layer).map((q) => ({ ...q, by: "code" as const })), lookups: [], done: false, understood: [], terms: [], choices: [], situation, noted: [] };
  }
  const dropped: { why: string; item: unknown }[] = [];
  const hay = material.replace(/(^|\s)[a-z]\d+(?:-\d+)? ·/gm, "$1");
  // Nothing looked up before they've answered anything: the rules and fields stay as they are, so the cache holds.
  // Asking to see the screen: only about a page or a step of something they run (screens while it's built).
  const screens = playbook === "page" && situation.stage !== "idea" && (lab === true || lab.includes("screens"));
  const turn = sanitizeTurn(answer.data, checkOf(a, { who: "person", hay, terms: await store.getTerms(), kinds: answered ? kinds : [], decisions, tweak: planTweak, memory: known.ids, why: true, teach: level !== "seasoned", reflect: true, screens }), (why, item) => dropped.push({ why, item }));
  const raw = rec(answer.data);
  const theirs = answers.filter((x) => x.how === "own");
  const after = situationAfter(situation, raw.situation, { answered: new Set(theirs.map((x) => x.id)), said: [b.said, ...theirs.map((x) => x.answer)].join("\n") });
  const picked = PLAYBOOK_IDS.find((p) => p === raw.playbook);
  // What their answers said about the business: on its page at once, checked against those answers.
  const notes = sanitizeNotes(raw.business, { answers, flow: "consult", key: a.memory?.key ?? "consult" }, (why, item) => dropped.push({ why, item }));
  let noted: BusinessLine[] = [];
  if (notes.length)
    await store.changeBusiness((x) => {
      const r = noteLines(x, notes, { now: Date.now(), id: () => `b${nanoid(8)}` });
      noted = r.added;
      return r.business;
    });
  await store
    .putTrace({ id: nanoid(10), projectId: "plan", kind: "ask-turn", flow: "consult", at: Date.now(), ...(answer.model ? { model: answer.model } : {}), rounds: a.rounds.length, level, playbook, situation: after, recalled: { items: known.items, chars: known.block.length }, answer: answer.data, kept: { questions: turn.questions.map((q) => ({ id: q.id, title: q.title, after: q.after })), lookups: turn.lookups, done: turn.done, noted: noted.map((l) => [l.section, l.text, l.by]) }, dropped } as { id: string; projectId: string })
    .catch(() => {});
  return { ...turn, questions: await withKnown(store, turn.questions, subjectOf(a, { flow: "consult", words: b.said })), situation: after, ...(picked ? { picked } : {}), noted };
}
