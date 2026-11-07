import { nanoid } from "nanoid";
import { z } from "zod";
import { askTurnCall } from "@/ai/asking";
import { structured } from "@/ai/server";
import { sanitizeTurn } from "@/asking/sanitize";
import type { AskTurn } from "@/asking/types";
import { AskingIn, askingBlock, checkOf } from "@/asking/wire";
import { DUMP_ROLES, type DumpRole } from "@/discovery/dump";
import { labOn } from "../lab";
import { companyContext } from "./company";
import type { OrgStore } from "./store";

/*
 * The interview before a card's draft (src/asking/, from the canvas's chat): one turn of it, in the core.
 * It reads the card, what's above it, what was found on their words, and the conversation so far, and
 * asks every question it can ask now, what each waits on, and what to look up rather than ask. The
 * draft that follows is the card's own (Draft solutions, Draft its problems, Break it down, its tests).
 */

export const AskCardBody = z.object({
  card: z.object({ kind: z.enum(["outcome", "opportunity", "solution", "test"]), title: z.string().max(400), description: z.string().max(600), above: z.array(z.string().max(400)).max(8) }),
  step: z.enum(["draft-solutions", "break-down", "draft-problems", "draft-tests"]),
  found: z.array(z.object({ id: z.string().max(24), text: z.string().max(1200), source: z.string().max(300), whose: z.string().max(40) })).max(20),
  asking: AskingIn,
});
export type AskCardBodyT = z.infer<typeof AskCardBody>;

const STEP_WORDS: Record<AskCardBodyT["step"], string> = { "draft-solutions": "Draft solutions for it", "break-down": "Break it down into the goals under it", "draft-problems": "Draft its problems", "draft-tests": "Draft tests of its riskiest assumptions" };
const KIND_WORDS: Record<AskCardBodyT["card"]["kind"], string> = { outcome: "a goal", opportunity: "a problem", solution: "a solution", test: "a test" };
const ROLES = [...DUMP_ROLES, "none"] as const;
const KINDS = ["project", "web"] as const;

/**
 * What a turn reads about the card: the card, what's above it, the company, and what was found on their
 * words (q…). "Found nothing" only when a search of the project ran: before one has, it says so, so the
 * turn can ask for one rather than take an empty search as an answer.
 */
export function cardMaterial(company: string, b: Omit<AskCardBodyT, "asking"> & { searched?: boolean }): string {
  return [
    `The card (${KIND_WORDS[b.card.kind]}): “${b.card.title}”`,
    b.card.description.trim() ? `What it says: ${b.card.description.trim()}` : "",
    ...(b.card.above.length ? ["Above it:", ...b.card.above.map((t) => `- ${t}`)] : []),
    `What comes next: ${STEP_WORDS[b.step]}`,
    ...(company.trim() ? ["", company.trim()] : []),
    "",
    b.found.length ? "What the organization's search found on their words (id · whose · source · words):" : b.searched ? "The organization's search found nothing on their words." : "Their project hasn't been searched in this conversation yet.",
    ...b.found.map((q) => `- ${q.id} · ${q.whose} · ${q.source} · “${q.text}”`),
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

/** One turn of the card's interview; any trouble fails it for Try again. */
export async function askCard(store: OrgStore, b: AskCardBodyT, emit: (label: string) => void, signal: AbortSignal, deps: { structured: typeof structured } = { structured }): Promise<AskTurn & { role: DumpRole | null }> {
  emit("Working out what to ask");
  const searched = b.asking.lookups.some((l) => l.kind === "project" && l.state === "done");
  const base = cardMaterial(await companyContext(store, { near: b.card.title }), { ...b, searched });
  const material = [base, askingBlock(b.asking)].join("\n\n");
  const lab = await labOn();
  const decisions = lab === true || lab.includes("decisions");
  const call = askTurnCall({ flow: "card", who: "person", material, kinds: KINDS, terms: true, choices: decisions, extra: { role: { type: "string", enum: [...ROLES], description: "What their own words in the first answer are to the tree; none when they wrote nothing" } } });
  const { data, model } = await deps.structured<unknown>(call, signal);
  const dropped: { why: string; item: unknown }[] = [];
  // The ids heading each listed line (q1, l0-2, bg-online-1) are never words a question may rest on.
  const hay = material.replace(/^(\s*- )[\w-]+ ·/gm, "$1");
  const turn = sanitizeTurn(data, checkOf(b.asking, { who: "person", hay, terms: await store.getTerms(), kinds: KINDS, decisions }), (why, item) => dropped.push({ why, item }));
  const r = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const role = DUMP_ROLES.find((x) => x === r.role) ?? null;
  await store
    .putTrace({ id: nanoid(10), projectId: "asking", kind: "ask-turn", flow: "card", step: b.step, at: Date.now(), ...(model ? { model } : {}), rounds: b.asking.rounds.length, answer: data, kept: { questions: turn.questions.map((q) => ({ id: q.id, title: q.title, after: q.after })), lookups: turn.lookups, done: turn.done, terms: turn.terms.map((t) => t.term) }, dropped } as { id: string; projectId: string })
    .catch(() => {});
  return { ...turn, role };
}
