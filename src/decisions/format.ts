import { metricText } from "@/discovery/dump";
import { dayOf, sanitizeDecision, type Decision } from "./model";

/**
 * The decision log as Markdown, one file a month (decisions/<YYYY-MM>.md), newest at the end, so
 * Git can merge two people's additions (union merge). Each entry reads on its own:
 *
 *   ## 2026-10-27 · Dropped the solution “Saved baskets” · Reorders
 *   <!-- qalam:decision {...} -->
 *
 *   **Why:** Folded into the order-again shelf.
 *
 *   **What we knew then:** 2 quotes · 1 against · 1 test (Failed)
 *   - “I rebuild my basket every week” · Sara interview
 *
 * The comment carries the whole record, so code reads it back exactly; the Why line is read from
 * the text, so it can be written or corrected in the file by hand.
 */

const MARK = "qalam:decision";
const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

/** One entry's Markdown. */
export function decisionToMarkdown(d: Decision): string {
  const { why, ...record } = d;
  // A quote can hold "-->", which would end the comment early: JSON reads \u003e back as ">".
  const json = JSON.stringify(record).replace(/>/g, "\\u003e");
  const lines: string[] = [`## ${dayOf(d.at)} · ${oneLine(d.what)}${d.undone ? " (undone)" : ""} · ${oneLine(d.boardName)}`, `<!-- ${MARK} ${json} -->`, ""];
  if (d.by === "qalam") lines.push("*Proposed by Qalam AI, accepted by you.*", "");
  lines.push(`**Why:** ${why?.trim() ? oneLine(why) : "—"}`);
  const k = d.knew;
  if (k) {
    const facts = [
      k.evidence,
      k.against && !/against/.test(k.evidence) ? `${k.against} against` : "",
      k.tests?.length ? `${k.tests.length} ${k.tests.length === 1 ? "test" : "tests"} (${k.tests.map((t) => t.stage).join(", ")})` : "",
      k.metric ? metricText(k.metric) : "",
      k.children ? `${k.children} ${k.children === 1 ? "card" : "cards"} under it` : "",
    ].filter(Boolean);
    lines.push("", `**What we knew then:** ${facts.join(" · ") || "nothing on the card"}`);
    for (const p of k.pieces) lines.push(`- “${oneLine(p.text)}”${p.from ? ` · ${oneLine(p.from)}` : ""}`);
  }
  const proposed = Array.isArray(d.detail?.proposals) ? (d.detail.proposals as { line?: unknown; why?: unknown }[]) : [];
  if (!k && proposed.length) {
    lines.push("", "**What Qalam AI proposed:**");
    for (const p of proposed) if (typeof p.line === "string") lines.push(`- ${oneLine(p.line)}${typeof p.why === "string" && p.why.trim() ? `: ${oneLine(p.why)}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

/** A month file's header. */
export const monthHeader = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
  return `# Decisions · ${name}\n\nWhat the team decided on its boards, recorded by Qalam as it happened, with what each card rested on at the time.\n`;
};

/** Split a month file into its entries (each with its text), after the header. */
export function entriesOf(md: string): { decision: Decision; text: string }[] {
  const out: { decision: Decision; text: string }[] = [];
  const chunks = md.replace(/\r\n/g, "\n").split(/^(?=## )/m);
  for (const text of chunks) {
    if (!text.startsWith("## ")) continue;
    const m = new RegExp(`<!--\\s*${MARK}\\s+(\\{.*\\})\\s*-->`).exec(text);
    if (!m) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const why = /^\*\*Why:\*\*[ \t]*(.*)$/m.exec(text)?.[1]?.trim();
    const decision = sanitizeDecision({ ...(raw as object), why: why && why !== "—" ? why : undefined });
    if (decision) out.push({ decision, text });
  }
  return out;
}

/**
 * The decisions in a month file. When Git kept both sides of the same entry (two people changed
 * it at once), it reads once: the later copy, with a why from either.
 */
export function decisionsFromMarkdown(md: string): Decision[] {
  const byId = new Map<string, Decision>();
  for (const { decision: d } of entriesOf(md)) {
    const had = byId.get(d.id);
    byId.delete(d.id);
    byId.set(d.id, had && !d.why && had.why ? { ...d, why: had.why } : d);
  }
  return [...byId.values()];
}

/** Append entries to a month file (made with its header if it's new). */
export function appendEntries(md: string | null, month: string, list: Decision[]): string {
  const head = md?.trim() ? md.replace(/\s*$/, "\n") : monthHeader(month);
  return `${head}\n${list.map(decisionToMarkdown).join("\n")}`;
}

/** Rewrite one entry in a month file, leaving the rest of the file as it is. Null: not in this file. */
export function replaceEntry(md: string, d: Decision): string | null {
  const chunks = md.replace(/\r\n/g, "\n").split(/^(?=## )/m);
  let found = false;
  const next = chunks.map((text) => {
    if (!text.startsWith("## ")) return text;
    const entry = entriesOf(text)[0];
    if (entry?.decision.id !== d.id) return text;
    found = true;
    // Keep the blank line that separated it from the next entry.
    const gap = /\n+$/.exec(text)?.[0] ?? "\n";
    return decisionToMarkdown(d).replace(/\n+$/, "") + (gap.length > 1 ? gap : "\n\n");
  });
  return found ? next.join("") : null;
}
