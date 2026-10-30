import type { ChatMessage, ChatPart, ChatStep, PartData, StepState } from "../chat/types";
import type { SeenMap, SeenQuestion, SeenReading } from "@/seen/types";

/*
 * Reading screenshots as a conversation (pure): every message is read from the reading the core
 * keeps (chats/seen/<key>.json) and what the window holds for now (uploads under way, the answers
 * to this round so far, the flows ticked), so a reload shows the same thread. Qalam AI says a
 * sentence or two; what to act on is a part the page draws: the drop area, the screenshots, a
 * question with the screens it's about and why it asks, the review.
 */

export interface ReadingInput {
  productName: string;
  reading: SeenReading | null;
  /** What's kept for the product already. */
  map: SeenMap | null;
  /** This Mac reads the words on screenshots (qalam-see). */
  words: boolean;
  /** Screenshots the window is keeping now. */
  adding: { count: number; done: number } | null;
  /** This round's answers so far, by question. */
  answers: Record<string, string>;
  /** Flows ticked or crossed in the review. */
  decided: Record<string, "accepted" | "discarded">;
  error: string | null;
}

const text = (t: string): ChatPart => ({ type: "text", text: t });
const part = (name: string, data: PartData = {}): ChatPart => ({ type: "data", name, data });
const ai = (id: string, ...parts: ChatPart[]): ChatMessage => ({ id, role: "assistant", parts });
const you = (id: string, ...parts: ChatPart[]): ChatMessage => ({ id, role: "user", parts });
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The round waiting on the person, and its first question not answered yet. */
export function openQuestion(i: Pick<ReadingInput, "reading" | "answers">): SeenQuestion | null {
  const r = i.reading;
  if (r?.phase !== "asking") return null;
  return r.rounds[r.rounds.length - 1]?.questions.find((q) => !i.answers[q.id]) ?? null;
}

/** Flows the review offers: new or changed ones (a kept flow the proposal leaves as it was isn't asked about). */
export function offered(r: SeenReading | null, kept: SeenMap | null): SeenMap["flows"] {
  if (!r?.proposal) return [];
  const before = new Map((kept?.flows ?? []).map((f) => [f.key, JSON.stringify(f)]));
  return r.proposal.flows.filter((f) => before.get(f.key) !== JSON.stringify(f));
}

export function readingThread(i: ReadingInput): ChatMessage[] {
  const out: ChatMessage[] = [];
  const r = i.reading;
  const screens = i.map?.screens.length ?? 0;
  const flows = i.map?.flows.length ?? 0;
  const fresh = !r || r.phase === "done" || r.phase === "failed";
  out.push(
    ai(
      "intro",
      text(screens ? `${i.productName} has ${n(screens, "screen")} in ${n(flows, "flow")}. Add more screenshots and I'll fit them in.` : `Add screenshots of ${i.productName}: I'll read each one, put them into flows, and ask where I can't tell.`),
      ...(fresh && r?.phase !== "done" ? [part("drop")] : []),
    ),
  );
  if (i.adding) out.push(you("adding", part("adding", { count: i.adding.count, done: i.adding.done })));
  if (!r) return out;

  out.push(you("shots", part("shots", { count: r.shots.length })));
  if (!r.words && r.phase !== "failed") out.push(ai("no-words", text("This Mac can't read the words on screenshots, so I'll keep no label or number I can't check, and I'll ask how screens connect.")));
  const read = Object.keys(r.notes).length;
  if (r.phase === "reading") out.push(ai("reading", text(r.activity ?? "Reading the screenshots…"), part("working")));
  else if (read) out.push(ai("read", text(`I read ${n(read, "screenshot")}${read < r.shots.length ? `; ${n(r.shots.length - read, "one")} I couldn't` : ""}.`)));

  r.rounds.forEach((round, k) => {
    const live = k === r.rounds.length - 1 && r.phase === "asking";
    const said = live ? i.answers : Object.fromEntries(round.answers.map((a) => [a.question, a.answer]));
    for (const q of round.questions) {
      out.push(ai(`q-${k}-${q.id}`, part("question", { round: k, id: q.id, live: live && !said[q.id] })));
      if (said[q.id]) out.push(you(`a-${k}-${q.id}`, text(said[q.id])));
      else if (live) break;
    }
  });

  if (r.phase === "placing") out.push(ai("placing", text(r.activity ?? "Putting them into flows…"), part("working")));
  if (r.phase === "asking" && !openQuestion(i)) out.push(ai("sending", part("send")));
  if (r.phase === "review" && r.proposal) {
    const offer = offered(r, i.map);
    const placed = new Set(r.proposal.flows.flatMap((f) => f.steps));
    const loose = r.proposal.screens.filter((s) => !placed.has(s.key)).length;
    out.push(
      ai(
        "review",
        text(offer.length ? `Here's how I'd put them: ${n(offer.length, "flow")}${loose ? `, and ${n(loose, "screen")} in no flow yet` : ""}. Accept the flows that are right.` : `I didn't find a flow in these${loose ? `: ${n(loose, "screen")} stay in no flow` : ""}. Keep the screens to find them later.`),
        part("review"),
      ),
    );
  }
  if (r.phase === "done") out.push(ai("done", text(`Added to ${i.productName}.`), part("done")));
  if (r.phase === "failed") out.push(ai("failed", text(r.error ?? "Something went wrong."), part("retry")));
  if (i.error) out.push(ai("error", text(i.error)));
  return out;
}

export function readingSteps(i: Pick<ReadingInput, "reading">): ChatStep[] {
  const r = i.reading;
  const at = !r || r.phase === "failed" ? 0 : r.phase === "reading" ? 1 : r.phase === "placing" || r.phase === "asking" ? 2 : r.phase === "review" ? 3 : 4;
  const state = (k: number): StepState => (k < at ? "done" : k === at ? "now" : "next");
  return [
    { id: "add", label: "Add", state: state(0) },
    { id: "read", label: "Read", state: state(1) },
    { id: "place", label: "Place", state: state(2) },
    { id: "notes", label: "Notes", state: state(3) },
  ];
}

/** What the composer takes: an answer to the open question, or nothing. */
export function readingAsk(i: Pick<ReadingInput, "reading" | "answers">): { kind: "answer"; question: string; placeholder: string } | { kind: "none"; placeholder: string } {
  const q = openQuestion(i);
  if (q) return { kind: "answer", question: q.id, placeholder: q.options.length ? "Pick one, or say it in your words…" : "Your answer…" };
  const r = i.reading;
  return { kind: "none", placeholder: r?.phase === "reading" || r?.phase === "placing" ? "Qalam AI is working…" : "Add screenshots above" };
}
