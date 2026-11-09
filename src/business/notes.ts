import { holdWords, sameWords } from "@/hub/topics";
import { lineText, type BusinessNote } from "./edit";
import { isSection } from "./types";

/*
 * What a consultant's turn says an answer told about the business, as code keeps it (pure): only from
 * an answer in their own words (never one that agreed to Qalam AI's recommendation, a don't-know or one
 * they left), their words where the line is found in that answer word for word, else Qalam AI's reading
 * of it, held to what it said (a number only where they gave it). A few a turn.
 */

export const NOTES_PER_TURN = 3;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");

export function sanitizeNotes(raw: unknown, o: { answers: readonly { id: string; answer: string; how: string }[]; flow: string; key: string }, dropped?: (why: string, item: unknown) => void): BusinessNote[] {
  const out: BusinessNote[] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const x = rec(item);
    const q = str(x.q, 80);
    const a = o.answers.find((y) => y.id === q);
    const text = str(x.text, 400);
    if (!isSection(x.section) || !text) {
      dropped?.("not a line about the business", item);
      continue;
    }
    if (!a || a.how !== "own" || !a.answer.trim()) {
      dropped?.("not from an answer in their own words", item);
      continue;
    }
    const theirs = x.theirs === true && ` ${sameWords(a.answer)} `.includes(` ${sameWords(text)} `);
    const held = theirs ? text : holdWords(text, a.answer, { max: 400, shape: "prose" }).text;
    if (held.split(" ").length < 2) {
      dropped?.("nothing left once what they didn't say is out", item);
      continue;
    }
    if (out.some((n) => n.section === x.section && sameWords(n.text) === sameWords(held))) continue;
    out.push({ section: x.section, text: lineText(held), by: theirs ? "said" : "qalam", from: [{ flow: o.flow, key: o.key, q }] });
    if (out.length >= NOTES_PER_TURN) break;
  }
  return out;
}
