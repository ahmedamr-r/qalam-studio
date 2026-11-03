import { audiencesCall, firstPickCall, QUESTIONS_SYSTEM } from "@/ai/scan";
import { findQuestionsSchema } from "@/ai/find";
import type { PlanQuestion } from "@/ai/plan";
import { structured } from "@/ai/server";
import { quotePiece, type SourceQuote, type SourceRecord } from "@/discovery/sources";
import type { Drafted, SolutionDraft } from "@/discovery/solutions";
import { emptyFiling } from "@/hub/topics";
import { audiencesMaterial, firstPickMaterial, problemFor, sanitizeAudiences, sanitizeFirstPick, scanRound, type FirstPick, type PlanProblem, type PlanWord, type ScanAudience } from "@/scan/plan";
import type { ScanTarget } from "@/scan/session";
import { notAsked, toldLines, type ScanSaid } from "@/scan/steer";
import { sanitizeFindQuestions } from "@/space/find";
import { nanoid } from "nanoid";
import { draftSolutions } from "./solutions";
import { needsNow } from "./needs";
import type { OrgStore } from "./store";

/**
 * From a scan's problems to what to build first (src/scan/plan.ts), in the core: its questions, the
 * audiences its quotes show, a person's pick kept as a segment page, and one solution to build first.
 * Each asks when the person gets there; what they decide is kept in the chat's turn.
 */

export interface ScanPlanDeps {
  structured: <T>(call: Parameters<typeof structured>[0], signal?: AbortSignal) => Promise<{ data: T; model?: string }>;
  draft: (store: OrgStore, req: { topic: string; answers?: string }, signal?: AbortSignal) => Promise<Drafted>;
}

const liveDeps: ScanPlanDeps = { structured, draft: (store, req, signal) => draftSolutions(store, req, undefined, { ...(signal ? { signal } : {}) }) };

const MAX_WORDS = 60;
const MAX_PUBLISHED = 12;

/**
 * The quotes the scan kept that a page cites, and the pages they're on, best backed first. Who it's
 * for and what comes first rest on people's words alone; what's been published is said beside them.
 */
export async function planMaterial(store: OrgStore, sources: readonly string[]): Promise<{ problems: PlanProblem[]; words: PlanWord[]; published: string[] }> {
  const all = (await Promise.all(sources.map((id) => store.getSource(id)))).filter((s): s is SourceRecord => !!s);
  const kept = all.filter((s) => s.kind !== "url");
  const published = all.filter((s) => s.kind === "url").flatMap((s) => s.quotes.slice(0, 4).map((q) => `${q.text} (${s.title})`)).slice(0, MAX_PUBLISHED);
  const byRef = new Map<string, { q: SourceQuote; s: SourceRecord }>(kept.flatMap((s) => s.quotes.map((q) => [quotePiece(q.id), { q, s }] as const)));
  const topics = (await store.listTopics()).filter((t) => t.kind === "need");
  const rank = new Map((await needsNow(store)).needs.map((n, i) => [n.topic, i]));
  const problems = topics
    .map((t) => ({ id: t.id, title: t.title, lines: t.lines.filter((l) => l.section !== "against").map((l) => l.text).slice(0, 12), cites: [...new Set(t.lines.flatMap((l) => l.cites))].filter((c) => byRef.has(c)) }))
    .filter((p) => p.cites.length)
    .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || b.cites.length - a.cites.length);
  // Each problem's quotes in turn, so one big problem doesn't take them all.
  const words: PlanWord[] = [];
  const seen = new Set<string>();
  for (let i = 0; words.length < MAX_WORDS && problems.some((p) => p.cites[i]); i++)
    for (const p of problems) {
      const ref = p.cites[i];
      const at = ref ? byRef.get(ref) : undefined;
      if (!at || seen.has(ref) || words.length >= MAX_WORDS) continue;
      seen.add(ref);
      words.push({ ref, text: at.q.text, source: at.s.title, ...(at.s.origin ? { origin: at.s.origin } : {}) });
    }
  return { problems, words, published };
}

/** The questions before it works out who and what: Qalam AI's from what it read, else code's own, and neither what they've answered while it read. */
export async function planQuestions(store: OrgStore, o: { target: ScanTarget; sources: readonly string[]; told?: readonly ScanSaid[] }, signal?: AbortSignal, deps: ScanPlanDeps = liveDeps): Promise<PlanQuestion[]> {
  const told = o.told ?? [];
  const { problems, words, published } = await planMaterial(store, o.sources);
  const about = o.target.kind === "idea" ? `What they want to build: ${o.target.said}` : `The product: ${o.target.name}`;
  const text = [about, "", "The problems found:", ...problems.slice(0, 8).map((p) => `- ${p.title}`), "", "What people say, in public:", ...words.slice(0, 24).map((w) => `- ${w.text}`), ...(published.length ? ["", "What's been published around it (someone else's words):", ...published.map((w) => `- ${w}`)] : []), ...(told.length ? ["", "What they've told you already (never ask it again):", toldLines({ said: [...told], off: [] })] : [])].join("\n");
  const m = { text, known: [...problems.map((p) => p.title), ...words.map((w) => w.text), ...published] };
  try {
    const { data } = await deps.structured<unknown>({ kind: "find-questions", system: QUESTIONS_SYSTEM, schema: findQuestionsSchema(), effort: "low", maxTokens: 3000, content: [{ type: "text", text }] }, signal);
    const kept = sanitizeFindQuestions(data, m);
    return notAsked(kept.length ? kept : scanRound(), told);
  } catch (e) {
    if (signal?.aborted) throw e;
    return notAsked(scanRound(), told);
  }
}

/** Their answers as a source of their own words, so drafts can rest on them. Null with nothing answered. */
export async function keepAnswers(store: OrgStore, said: readonly { question: string; answer: string }[], title: string): Promise<string | null> {
  const pairs = said.map((x) => ({ question: x.question.trim(), answer: x.answer.trim() })).filter((x) => x.answer);
  if (!pairs.length) return null;
  const parts: string[] = [];
  const quotes: SourceQuote[] = [];
  let at = 0;
  for (const p of pairs) {
    const head = `${p.question}\n`;
    const start = at + head.length;
    parts.push(`${head}${p.answer}`);
    quotes.push({ id: nanoid(10), text: p.answer, span: [start, start + p.answer.length], kind: "idea", addedBy: "user", at: Date.now() });
    at = start + p.answer.length + 2;
  }
  const id = nanoid(10);
  await store.putSource({ v: 1, id, projectId: "", boards: [], product: null, kind: "dump", title: title.slice(0, 200), text: parts.join("\n\n"), addedAt: Date.now(), read: [], quotes, needs: [], filed: quotes.map((q) => q.id), answers: { v: 1, card: "", goal: null, topic: null, step: "draft-solutions", buckets: [], found: [], done: true, at: Date.now() } });
  return id;
}

/** The audiences its quotes show. None is a fair answer, and says so in the thread. */
export async function planAudiences(store: OrgStore, o: { target: ScanTarget; sources: readonly string[]; answers: string }, signal?: AbortSignal, deps: ScanPlanDeps = liveDeps): Promise<ScanAudience[]> {
  const { problems, words } = await planMaterial(store, o.sources);
  if (words.length < 2) return [];
  const m = audiencesMaterial({ target: o.target, answers: o.answers, problems, words });
  const { data, model } = await deps.structured<unknown>(audiencesCall(m.text), signal);
  const kept = sanitizeAudiences(data, m, { id: () => nanoid(8) });
  await store.putTrace({ id: nanoid(10), projectId: "scan", kind: "scan-audience", at: Date.now(), ...(model ? { model } : {}), answer: data, kept: kept.map((a) => a.name) } as { id: string; projectId: string }).catch(() => {});
  return kept;
}

/** The audience they picked, kept as a segment page citing what shows them (their own words cite nothing). */
export async function keepAudience(store: OrgStore, a: { name: string; about?: string; refs: readonly string[] }): Promise<void> {
  const f = emptyFiling();
  f.create.push({ key: "n1", kind: "segment", title: a.name.slice(0, 120), products: [] });
  f.add.push({ topic: "new:n1", section: "believe", text: a.about?.trim() || `Who to build for first: ${a.name}.`, cites: [...a.refs], from: [], products: [] });
  await store.fileTopics(f, { from: "What people complain about" });
}

export interface FirstBuild {
  topic: string;
  problem: string;
  drafts: SolutionDraft[];
  quotes: Drafted["quotes"];
  pick: FirstPick | null;
  note: string;
}

/** What to build first for them: solutions drafted for the problem their quotes bear on most, and one picked. */
export async function firstBuild(store: OrgStore, o: { target: ScanTarget; sources: readonly string[]; audience: string; refs: readonly string[]; answers: string; answersSource?: string; topic?: string }, signal?: AbortSignal, deps: ScanPlanDeps = liveDeps): Promise<FirstBuild | null> {
  const { problems, words, published } = await planMaterial(store, o.sources);
  const problem = (o.topic ? problems.find((p) => p.id === o.topic) : null) ?? problemFor(problems, o.refs.map((ref) => ({ ref })));
  if (!problem) return null;
  const d = await deps.draft(store, { topic: problem.id, ...(o.answersSource ? { answers: o.answersSource } : {}) }, signal);
  const own = new Set(problem.cites);
  const m = firstPickMaterial({ target: o.target, audience: o.audience, answers: o.answers, problem, words: words.filter((w) => own.has(w.ref)).map((w) => w.text).slice(0, 20), published, drafts: d.drafts });
  const asked = d.drafts.length ? await deps.structured<unknown>(firstPickCall(m.text), signal) : null;
  const pick = asked ? sanitizeFirstPick(asked.data, m) : null;
  if (asked) await store.putTrace({ id: nanoid(10), projectId: "scan", kind: "scan-pick", at: Date.now(), ...(asked.model ? { model: asked.model } : {}), answer: asked.data, kept: pick } as { id: string; projectId: string }).catch(() => {});
  return { topic: problem.id, problem: problem.title, drafts: d.drafts, quotes: d.quotes, pick, note: d.note };
}
