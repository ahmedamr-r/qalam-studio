/**
 * The project brief as requests send it (pure), with each fact's id in front ([b2]) and the
 * manifest of what was sent. Forgotten facts are left out; pinned answers are sent whatever the
 * limit on answers.
 */
import { TOPIC_LABEL, screenBriefFor, type BriefPayload } from "@/doc/brief";
import type { Doc, ProjectBrief } from "@/doc/schema";
import { ref } from "./refs";
import { entry, type ManifestEntry } from "./trace";
import type { KnowledgeControls } from "./types";

const ANSWERS_SENT = 30;

/** A screen's goal fields as one fact: what the trace hashes, so an edit since can be told apart. */
export const screenGoalText = (s: { goal: string; firstNotice: string; primaryAction: string }) => [s.goal, s.firstNotice, s.primaryAction].filter(Boolean).join(" · ");

/** The words a brief fact is recorded by (whatever part of it a prompt shows). */
export function briefFactText(b: ProjectBrief | undefined, doc: Doc, r: string): string | null {
  if (!b) return null;
  if (r === ref.summary) return b.summary.trim() ? b.summary.slice(0, 2000) : null;
  if (r.startsWith("brief:answer:")) {
    const a = b.answers.find((x) => ref.answer(x.id) === r);
    return a ? a.answer.slice(0, 600) : null;
  }
  if (r.startsWith("brief:screen:")) {
    const s = screenBriefFor(b, doc, r.slice("brief:screen:".length));
    return s ? screenGoalText(s) || null : null;
  }
  if (r.startsWith("brief:verdict:")) {
    const lc = screenBriefFor(b, doc, r.slice("brief:verdict:".length))?.lastCritique;
    return lc ? `${new Date(lc.at).toISOString().slice(0, 10)}: ${lc.verdict} — ${lc.headline}${lc.keyIssues.length ? ` (flagged: ${lc.keyIssues.join("; ")})` : ""}`.slice(0, 990) : null;
  }
  return null;
}
const MAX_PINNED = 20;

function numberer(prefix: string) {
  let n = 0;
  const entries: ManifestEntry[] = [];
  const tag = (r: string, text: string) => {
    const short = `${prefix}${++n}`;
    entries.push(entry(short, r, text));
    return `[${short}] ${text}`;
  };
  return { tag, entries };
}

/** Answers to send: the newest unpinned ones up to the limit, plus every pinned one, in their order. */
export function answersToSend<T extends { id: string }>(answers: T[], controls: KnowledgeControls | undefined, limit = ANSWERS_SENT): T[] {
  const forgotten = controls?.forgotten ?? {};
  const pinned = controls?.pinned ?? {};
  const live = answers.filter((a) => !forgotten[ref.answer(a.id)]);
  const keepPinned = new Set(live.filter((a) => pinned[ref.answer(a.id)]).slice(-MAX_PINNED).map((a) => a.id));
  const keepRecent = new Set(live.filter((a) => !keepPinned.has(a.id)).slice(-limit).map((a) => a.id));
  return live.filter((a) => keepPinned.has(a.id) || keepRecent.has(a.id));
}

/**
 * The brief as a critique sends it: briefForRequest's shape, with ids in front of each fact.
 * Answers given in the current session (at >= since) are left out; the transcript carries them.
 */
export function critiqueBrief(b: ProjectBrief | undefined, doc: Doc, sessionIds: string[], since: number, controls?: KnowledgeControls): { payload: BriefPayload; entries: ManifestEntry[] } {
  const { tag, entries } = numberer("b");
  const nameOf = (id: string) => doc.nodes[id]?.name ?? b?.screens[id]?.name ?? "deleted screen";
  if (!b) return { payload: { summary: "", answers: [], screens: [], otherScreens: [] }, entries };
  const off = (r: string) => !!controls?.forgotten[r];
  const summary = b.summary && !off(ref.summary) ? tag(ref.summary, b.summary.slice(0, 2000)) : "";
  const answers = answersToSend(
    b.answers.filter((a) => a.at < since),
    controls,
  ).map((a) => ({ topic: a.topic, question: a.question.slice(0, 300), answer: tag(ref.answer(a.id), a.answer.slice(0, 600)), screens: a.screenIds.map((id) => nameOf(id).slice(0, 120)).slice(0, 4) }));
  const screens = sessionIds.flatMap((id) => {
    const s = screenBriefFor(b, doc, id);
    if (!s) return [];
    const goalOff = off(ref.screenGoal(id));
    const lc = s.lastCritique && !off(ref.verdict(id)) ? s.lastCritique : undefined;
    // The goal fields are one fact in the hub: one id, in front of the first field that has words.
    const fields = goalOff ? { goal: "", firstNotice: "", primaryAction: "" } : { goal: s.goal, firstNotice: s.firstNotice, primaryAction: s.primaryAction };
    const first = (["goal", "firstNotice", "primaryAction"] as const).find((k) => fields[k]);
    if (first) {
      fields[first] = tag(ref.screenGoal(id), fields[first]);
      // The fact as the hub shows it is all three fields.
      const e = entries[entries.length - 1];
      entries[entries.length - 1] = entry(e.short, e.ref, screenGoalText(s));
    }
    return [
      {
        id,
        name: nameOf(id).slice(0, 120),
        ...fields,
        inheritedFrom: s.inheritedFrom ?? "",
        lastCritique: lc ? tag(ref.verdict(id), `${new Date(lc.at).toISOString().slice(0, 10)}: ${lc.verdict} — ${lc.headline}${lc.keyIssues.length ? ` (flagged: ${lc.keyIssues.join("; ")})` : ""}`.slice(0, 990)) : "",
      },
    ];
  });
  const otherScreens = Object.entries(b.screens)
    .filter(([id, s]) => !sessionIds.includes(id) && doc.nodes[id] && s.goal && !off(ref.screenGoal(id)))
    .slice(0, 12)
    .map(([id, s]) => ({ name: nameOf(id).slice(0, 120), goal: tag(ref.screenGoal(id), s.goal.slice(0, 300)) }));
  return { payload: { summary, answers, screens, otherScreens }, entries };
}

/**
 * The brief as Generate sends it: the summary, the goals of the screens the request is about, and
 * the answers the designer pinned. Small on purpose: Generate already gets the chat and the system.
 */
export function generateBrief(b: ProjectBrief | undefined, doc: Doc, screenIds: string[], controls?: KnowledgeControls): { text: string; entries: ManifestEntry[] } {
  const { tag, entries } = numberer("b");
  if (!b) return { text: "", entries };
  const off = (r: string) => !!controls?.forgotten[r];
  const lines: string[] = [];
  const canonical = () => {
    const e = entries[entries.length - 1];
    entries[entries.length - 1] = entry(e.short, e.ref, briefFactText(b, doc, e.ref) ?? e.text);
  };
  if (b.summary.trim() && !off(ref.summary)) {
    lines.push(`What the project solves: ${tag(ref.summary, b.summary.slice(0, 1200))}`);
    canonical();
  }
  for (const id of screenIds.slice(0, 4)) {
    const s = screenBriefFor(b, doc, id);
    if (!s || off(ref.screenGoal(id))) continue;
    const goal = [s.goal && `goal: ${s.goal}`, s.firstNotice && `must be noticed first: ${s.firstNotice}`, s.primaryAction && `primary action: ${s.primaryAction}`].filter(Boolean).join("; ");
    if (goal) {
      lines.push(`Screen "${(doc.nodes[id]?.name ?? s.name).slice(0, 120)}": ${tag(ref.screenGoal(id), goal.slice(0, 900))}`);
      canonical();
    }
  }
  const pinned = controls?.pinned ?? {};
  const kept = b.answers.filter((a) => pinned[ref.answer(a.id)] && !off(ref.answer(a.id))).slice(-MAX_PINNED);
  if (kept.length) {
    lines.push("Answers the designer pinned:");
    for (const a of kept) lines.push(`- ${TOPIC_LABEL[a.topic]} (asked "${a.question.slice(0, 160)}"): ${tag(ref.answer(a.id), a.answer.slice(0, 600))}`);
  }
  return { text: lines.join("\n"), entries };
}
