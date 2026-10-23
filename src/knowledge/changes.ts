/**
 * What the designer changed since a decision (pure): facts it followed or was given that they
 * forgot or edited, rules removed, and what they told Qalam AI since. "Generate again" lists these
 * and sends them along, so the new design follows the fixed knowledge.
 */
import type { Doc } from "@/doc/schema";
import { briefFactText } from "./brief";
import { dsKeyOf, factHash, ref } from "./refs";
import type { DecisionTrace, KnowledgeGraph } from "./types";

export interface Change {
  kind: "forgot" | "edited" | "removed" | "told";
  ref: string;
  label: string;
  /** The words now (edited, told) or as they were (forgot, removed). */
  text: string;
  /** Edited: the words the decision read. */
  before?: string;
}

export function changesSince(t: Pick<DecisionTrace, "at" | "given" | "reliedOn" | "about" | "produced">, g: KnowledgeGraph, doc: Pick<Doc, "brief" | "knowledge" | "nodes" | "roots">): Change[] {
  const out: Change[] = [];
  const forgotten = doc.knowledge?.forgotten ?? {};
  const read = new Map(t.reliedOn.map((r) => [r.ref, r.text]));
  const given = new Set(t.given.map(([r]) => r));
  const labelOf = (r: string, fallback: string) => g.byRef.get(r)?.label ?? fallback;
  for (const [r, hash] of t.given) {
    if (r.startsWith("decision:") || r.startsWith("research:")) continue;
    const node = g.byRef.get(r);
    if ((forgotten[r] ?? 0) > t.at) {
      out.push({ kind: "forgot", ref: r, label: labelOf(r, read.get(r) ?? r), text: node?.text ?? read.get(r) ?? "" });
      continue;
    }
    const ds = dsKeyOf(r);
    if (ds) {
      // A rule edited since (in its system, or in the copy a built-in system's edit made) says what it replaced.
      const edited = g.nodes.find((n) => n.provenance?.editedFrom === ds.key && (n.provenance.at ?? 0) > t.at);
      if (edited) out.push({ kind: "edited", ref: edited.ref, label: edited.label, text: edited.text, before: read.get(r) ?? node?.text });
      else if (!node || node.status === "ghost") out.push({ kind: "removed", ref: r, label: labelOf(r, read.get(r) ?? r), text: read.get(r) ?? "" });
      continue;
    }
    if (r.startsWith("brief:")) {
      const now = briefFactText(doc.brief, doc as Doc, r);
      if (now === null) out.push({ kind: "removed", ref: r, label: labelOf(r, r), text: read.get(r) ?? "" });
      else if (factHash(now) !== hash) out.push({ kind: "edited", ref: r, label: labelOf(r, now), text: now, before: read.get(r) });
    }
  }
  // Told since: answers given after the decision, and a summary or screen goal it didn't have.
  for (const a of doc.brief?.answers ?? [])
    if (a.at > t.at && !given.has(ref.answer(a.id))) out.push({ kind: "told", ref: ref.answer(a.id), label: a.question || "Your answer", text: a.answer });
  const screens = [...new Set([...(t.about ?? []), ...(t.produced.frames ?? [])])];
  for (const r of [ref.summary, ...screens.map(ref.screenGoal)]) {
    if (given.has(r)) continue;
    const now = briefFactText(doc.brief, doc as Doc, r);
    if (now) out.push({ kind: "told", ref: r, label: r === ref.summary ? "What the project solves" : "Screen goal", text: now });
  }
  return out;
}

/** The changes as a line for the request that revises the design (the model gets the new facts anyway; this says what moved). */
export function changesNote(changes: Change[], max = 560): string {
  const parts = changes.flatMap((c) => {
    // Quotes inside a fact become curly, so the list can be read back (readRequest splits outside quotes).
    const q = (s: string) => `"${s.replace(/\s+/g, " ").replace(/"/g, "”").trim().slice(0, 140)}"`;
    if (c.kind === "forgot") return [`stop following ${q(c.text || c.label)}`];
    if (c.kind === "edited") return [c.before ? `${q(c.before)} is now ${q(c.text)}` : `updated: ${q(c.text)}`];
    if (c.kind === "told") return [`I told you ${c.label.replace(/\?$/, "").toLowerCase()}: ${q(c.text)}`];
    return [];
  });
  let note = "";
  for (const p of parts) if ((note + p).length + 2 <= max) note = note ? `${note}; ${p}` : p;
  return note;
}

const REVISE = "Revise this screen with what changed since: ";
const ORIGINAL = ' The original request: "';

/** The request "Generate again with your fixes" sends, built from the changes and the original request. */
export function reviseRequest(note: string, original: string): string {
  const lead = note ? `${REVISE}${note}.` : "Revise this screen.";
  return `${lead}${original ? `${ORIGINAL}${original.slice(0, 800 - lead.length - ORIGINAL.length - 1)}"` : ""}`.slice(0, 800);
}

/** A request read back: a "Generate again" revision (what changed, and the original ask), or a plain one. */
export function readRequest(text: string): { revise: boolean; changes: string[]; original: string } {
  if (!text.startsWith(REVISE) && !text.startsWith("Revise this screen.")) return { revise: false, changes: [], original: text };
  const i = text.indexOf(ORIGINAL);
  const head = i < 0 ? text : text.slice(0, i);
  const original = i < 0 ? "" : text.slice(i + ORIGINAL.length).replace(/"$/, "");
  const body = head.startsWith(REVISE) ? head.slice(REVISE.length).replace(/\.$/, "") : "";
  return { revise: true, changes: body ? splitOutsideQuotes(body) : [], original };
}

/** "a; "b; c"; d" → ["a", "\"b; c\"", "d"]: a fact's own semicolons stay inside its quotes. */
function splitOutsideQuotes(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === ";" && text[i + 1] === " ") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
