import { readFrontMatter } from "@/org/context-md";

/*
 * A playbook (src/consult/playbooks/<layer>/<id>.md, pure): what the consultant finds out, what people
 * usually miss, how it asks and what it proposes in one kind of situation. Front matter in JSON values
 * (the About's convention), four sections in Qalam's own words, by role, with no figures: a playbook
 * guides the questions, and nothing a card shows can come from it.
 *
 * The files are read into src/consult/playbooks.gen.ts by `pnpm gen:playbooks` (scripts/playbooks.mts),
 * since a Markdown import doesn't load everywhere Qalam runs; a test fails when the two differ.
 */

/** The four sections every playbook has, in this order. */
export const PLAYBOOK_HEADINGS = ["What to find out", "What people usually miss", "How to ask", "What to propose"] as const;

/** What the conversation ends in: a diagnosis (a goal, likely causes, a check under each) or goals. A skill (src/consult/skills/) ends in its own: `review`, findings on screens. */
export type PlaybookPropose = "diagnosis" | "goals" | "review";

export interface PlaybookCredit {
  source: string;
  license: string;
  url?: string;
  used: string;
}

export interface Playbook {
  id: string;
  /** The folder it's kept in: the layer of the business it works on. */
  layer: string;
  title: string;
  /** When it fits, a line each: the index every turn hears. */
  when: string[];
  propose: PlaybookPropose;
  credits: PlaybookCredit[];
  /** Its four sections, as Markdown. */
  body: string;
}

/** Licenses a playbook may learn from: never one for non-commercial use only, never one forbidding changes. */
export const unusable = (license: string) => /\b(NC|ND)\b|non-?commercial|no-?deriv/i.test(license);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);

/** A playbook from its file; throws on one that isn't whole, so a broken file can't ship. */
export function playbookFrom(text: string, path = "a playbook"): Playbook {
  const { fields: f, body } = readFrontMatter(text.replace(/\r\n/g, "\n"));
  const id = typeof f.id === "string" ? f.id.trim() : "";
  const layer = typeof f.layer === "string" ? f.layer.trim() : "";
  const title = typeof f.title === "string" ? f.title.trim() : "";
  const when = strings(f.when);
  const propose = f.propose === "diagnosis" || f.propose === "goals" || f.propose === "review" ? f.propose : null;
  const credits = (Array.isArray(f.credits) ? f.credits : []).flatMap((c): PlaybookCredit[] => {
    const r = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    return typeof r.source === "string" && typeof r.license === "string" && typeof r.used === "string" ? [{ source: r.source, license: r.license, ...(typeof r.url === "string" ? { url: r.url } : {}), used: r.used }] : [];
  });
  if (!/^[a-z][a-z-]{1,30}$/.test(id)) throw new Error(`${path}: its id is missing or not a short lowercase word`);
  if (!layer || !title || !when.length || !propose) throw new Error(`${path}: it needs a layer, a title, when it fits and what it proposes`);
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  if (headings.join("|") !== PLAYBOOK_HEADINGS.join("|")) throw new Error(`${path}: its sections must be ${PLAYBOOK_HEADINGS.join(", ")}, in that order`);
  return { id, layer, title, when, propose, credits, body: body.trim() };
}

/** Every playbook, in the order of their ids. */
export function playbooksFrom(files: readonly { path: string; text: string }[]): Playbook[] {
  const out = files.map((f) => playbookFrom(f.text, f.path)).sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const p of out) {
    if (seen.has(p.id)) throw new Error(`Two playbooks are called ${p.id}`);
    seen.add(p.id);
  }
  return out;
}

/** How many words a body runs to. */
export const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;
