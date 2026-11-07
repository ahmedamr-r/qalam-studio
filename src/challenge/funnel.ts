import { termsOf } from "@/code/steps";
import type { FunnelNumbers } from "@/goals/breakdown";

/*
 * Funnels in their own numbers (pure, no tokens): a sheet of figures kept as a source is read back
 * into its rows (tableText wrote each row as "column: value · column: value"), and a table whose rows
 * are a funnel's steps becomes one, as does a goal's funnel from the analytics tool. Each step says how
 * many people it loses: a column of losses as it's written, else worked out from the counts. A table of
 * months, or one that only happens to go down, is never read as a funnel.
 */

export interface TableRow {
  cells: Map<string, string>;
  /** The row as written, and where it is in the source's text. */
  text: string;
  span: [number, number];
}

const CELL = /^([^:·\n]{1,80}?):\s(.+)$/u;

/** A line as a table's row: every part a "column: value" cell, the column not a number. */
function cellsOf(line: string): Map<string, string> | null {
  const parts = line.split(" · ");
  if (parts.length < 2) return null;
  const cells = new Map<string, string>();
  for (const p of parts) {
    const m = CELL.exec(p.trim());
    if (!m || /^\d/.test(m[1].trim())) return null;
    cells.set(m[1].trim(), m[2].trim());
  }
  return cells;
}

/** The tables in a source's text: runs of 3 rows or more that share their columns. */
export function tablesIn(text: string): TableRow[][] {
  const out: TableRow[][] = [];
  let run: TableRow[] = [];
  const close = () => {
    if (run.length >= 3) out.push(run);
    run = [];
  };
  let at = 0;
  for (const line of text.split("\n")) {
    const start = at;
    at += line.length + 1;
    const cells = cellsOf(line);
    if (!cells) {
      close();
      continue;
    }
    // A row of another table starts a run of its own: at least half its columns are the run's.
    const head = run[0]?.cells;
    if (head && [...cells.keys()].filter((k) => head.has(k)).length * 2 < cells.size) close();
    run.push({ cells, text: line, span: [start, start + line.length] });
  }
  close();
  return out;
}

/** A cell as a number: "10,000", "4.5", "44%" (null when it isn't one). */
export function numberOf(v: string | undefined): { value: number; percent: boolean } | null {
  const s = (v ?? "").trim();
  const m = /^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(%)?$/.exec(s);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(value) ? { value, percent: !!m[2] } : null;
}

export interface FunnelStep {
  label: string;
  /** How many people it loses (null: not known). */
  lost: number | null;
  /** Of those who got to it, the share it loses (0 to 1; null: not known). */
  share: number | null;
  /** How many got to it. */
  entered: number | null;
  /** The row as written, and where it is in its source. */
  text: string;
  span?: [number, number];
}

export interface Funnel {
  /** Where it's from: the source's title, or the goal's funnel by name. */
  from: string;
  sourceId?: string;
  /** A goal's own funnel (from the analytics tool). */
  goal?: string;
  /** How many started it. */
  first: number | null;
  steps: FunnelStep[];
}

const header = (h: string) => h.replace(/[_\-]+/g, " ").toLowerCase();
const STEP_HEAD = /\b(step|stage|funnel|screen|page|event|action|phase|flow)s?\b/;
const LOSS_HEAD = /lost|loss|left|leav|drop|abandon|exit|churn|bounce/;
const SHARE_HEAD = /percent|pct|rate|share|ratio|%/;
const PASS_HEAD = /conver|pass|through|success|continu|kept|retain/;
const ENTER_HEAD = /enter|start|began|begin|reach|arriv|view|visit|land|saw|got to/;
const PERIOD = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\d{4}(?:[-/]\d{1,2})?\b|q[1-4]\b|h[12]\b|(?:week|wk|month|day|year)\b|w\d+\b|\d{1,2}[/-]\d{1,2}\b)/i;

/** A table as a funnel, when its rows are a funnel's steps (null otherwise). */
export function funnelOfTable(rows: readonly TableRow[], from: string, sourceId?: string): Funnel | null {
  if (rows.length < 3) return null;
  const columns = [...new Set(rows.flatMap((r) => [...r.cells.keys()]))];
  const values = (c: string) => rows.map((r) => r.cells.get(c));
  const numbers = (c: string) => values(c).map(numberOf);
  // The steps' names: a column of words, mostly different from row to row.
  const labelCol = columns.find((c) => {
    const vs = values(c);
    const words = vs.filter((v) => !!v && !numberOf(v));
    return words.length >= rows.length * 0.8 && new Set(words).size >= words.length * 0.8;
  });
  if (!labelCol) return null;
  const labels = values(labelCol).map((v) => (v ?? "").trim());
  // A table of months or weeks is a series, never a funnel.
  if (labels.filter((l) => PERIOD.test(l)).length * 2 >= labels.length) return null;
  const numeric = columns.filter((c) => c !== labelCol && numbers(c).filter(Boolean).length >= rows.length * 0.8);
  const isShare = (c: string) => SHARE_HEAD.test(header(c)) || numbers(c).every((n) => !n || n.percent);
  const lossCount = numeric.find((c) => LOSS_HEAD.test(header(c)) && !isShare(c));
  const lossShare = numeric.find((c) => LOSS_HEAD.test(header(c)) && isShare(c));
  const passShare = numeric.find((c) => !LOSS_HEAD.test(header(c)) && PASS_HEAD.test(header(c)) && isShare(c));
  const counts = numeric.filter((c) => !LOSS_HEAD.test(header(c)) && !isShare(c));
  // The people at each step: a count that only goes down from a first step above none.
  const goesDown = (c: string) => {
    const ns = numbers(c).map((n) => n?.value ?? null);
    return ns.every((n) => n !== null) && ns[0]! > 0 && ns.every((n, i) => i === 0 || n! <= ns[i - 1]!) && ns.at(-1)! < ns[0]!;
  };
  const count = counts.find((c) => goesDown(c) && ENTER_HEAD.test(header(c))) ?? counts.find(goesDown) ?? null;
  const entering = !!count && ENTER_HEAD.test(header(count));
  // A table that only happens to go down isn't a funnel: its steps are named as such, or its count says people got to each.
  if (!STEP_HEAD.test(header(labelCol)) && !(count && (entering || PASS_HEAD.test(header(count)) || /complet|finish|done|placed/.test(header(count))))) return null;
  if (!lossCount && !lossShare && !passShare && !count) return null;

  const at = (c: string | null | undefined, i: number) => (c ? (numberOf(rows[i].cells.get(c))?.value ?? null) : null);
  const steps: FunnelStep[] = rows.map((r, i) => {
    let lost = at(lossCount, i);
    let entered: number | null = null;
    if (count && entering) {
      entered = at(count, i);
      if (lost === null && i < rows.length - 1) lost = at(count, i) !== null && at(count, i + 1) !== null ? at(count, i)! - at(count, i + 1)! : null;
    } else if (count) {
      // Counts of those who did each step: a step loses those who did the one before and not it.
      entered = i ? at(count, i - 1) : at(count, 0);
      if (lost === null && i) lost = at(count, i - 1)! - at(count, i)!;
    }
    const shareCell = at(lossShare, i);
    const passCell = at(passShare, i);
    const share = shareCell !== null ? shareCell / 100 : passCell !== null ? 1 - passCell / 100 : lost !== null && entered ? lost / entered : null;
    return { label: labels[i], lost, share, entered, text: r.text, span: r.span };
  });
  const first = count ? at(count, 0) : null;
  return { from, ...(sourceId ? { sourceId } : {}), first, steps };
}

/** The funnels in a source's text. */
export function funnelsIn(text: string, from: string, sourceId?: string): Funnel[] {
  return tablesIn(text).flatMap((t) => funnelOfTable(t, from, sourceId) ?? []);
}

/** A goal's funnel from the analytics tool, as PostHog counts it: those who did each step. */
export function funnelOfNumbers(f: FunnelNumbers, goal: string): Funnel | null {
  if (f.steps.length < 3 || !(f.steps[0].count > 0)) return null;
  const steps = f.steps.map((s, i) => {
    const before = i ? f.steps[i - 1].count : null;
    const lost = before !== null ? before - s.count : null;
    return { label: s.label, lost, share: before ? lost! / before : null, entered: before ?? s.count, text: `${s.label}: ${s.count.toLocaleString("en-US")}` };
  });
  return { from: f.insight.name || "the goal's funnel", goal, first: f.steps[0].count, steps };
}

/** What a step loses, to compare steps by: people where every step that loses some says how many, else the share. */
export function lossBy(f: Funnel): "lost" | "share" | null {
  const losing = f.steps.filter((s) => (s.lost ?? 0) > 0 || (s.share ?? 0) > 0);
  if (losing.length < 2) return null;
  if (losing.every((s) => s.lost !== null) && f.steps.filter((s) => s.lost !== null).length >= 2) return "lost";
  return f.steps.filter((s) => s.share !== null).length >= 2 ? "share" : null;
}

/** The step that loses the most (-1: none can be told apart). */
export function biggestDrop(f: Funnel): number {
  const by = lossBy(f);
  if (!by) return -1;
  let worst = -1;
  f.steps.forEach((s, i) => {
    const v = s[by];
    if (v !== null && v > 0 && (worst < 0 || v > f.steps[worst][by]!)) worst = i;
  });
  return worst;
}

/** Words that say how a funnel counts, not which step: a step's own words are the rest. */
const COUNTING = new Set(termsOf("filled placed reached confirmed completed completion selected added finished done successful succeeded submitted landed visited arrived began begun went lost left leaving dropped abandoned exited total count rate percent funnel stage event events phase action"));

/** Each step's own words: the ones no other step of the funnel has. */
export function stepWords(f: Funnel): string[][] {
  const each = f.steps.map((s) => termsOf(s.label).filter((t) => !COUNTING.has(t)));
  return each.map((ts, i) => ts.filter((t) => !each.some((other, j) => j !== i && other.includes(t))));
}

/** The same word, stemmed: equal, or one starting the other and most of it ("deliver" and "delivery", never "team" and "teammate"). */
const sameWord = (t: string, w: string) => {
  if (t === w) return true;
  const [short, long] = t.length <= w.length ? [t, w] : [w, t];
  return short.length >= 4 && long.startsWith(short) && short.length >= long.length * 0.75;
};

/** The steps these words name, by a word of the step's own (stemmed, so "paying" names "Payment page reached"). */
export function stepsNamed(f: Funnel, words: string, own: string[][] = stepWords(f)): number[] {
  const mine = termsOf(words);
  return own.flatMap((ts, i) => (ts.some((t) => mine.some((w) => sameWord(t, w))) ? [i] : []));
}
