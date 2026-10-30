/*
 * A source that is a table (a CSV or TSV export: support tickets, survey answers, app reviews),
 * read by code (pure). Its text stays as it was, so quotes are still found word for word; code
 * knows where each row sits in it, so it can count how many rows a need shows up in ("12 of 340
 * tickets"), and, when a column names who wrote each row (a customer, an email), which rows are the
 * same person's. Nothing here is the model's: it never counts.
 */

export interface SourceTable {
  delimiter: "," | "\t" | ";";
  /** The header row's cells. */
  columns: string[];
  /** Data rows (the header not counted). */
  rows: number;
  /** The column naming who wrote each row, when there is one. */
  who?: string;
}

export interface Row {
  /** [start, end) of the row in the text. */
  start: number;
  end: number;
  cells: string[];
}

/** The rows of a delimited text, quoted fields (and quotes inside them, doubled) as RFC 4180 says. */
export function parseRows(text: string, delimiter: string, max = 200_000): Row[] {
  const rows: Row[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let start = 0;
  let i = 0;
  const endRow = (end: number) => {
    cells.push(cell);
    if (cells.some((c) => c.trim())) rows.push({ start, end, cells });
    cells = [];
    cell = "";
  };
  while (i < text.length && rows.length < max) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && !cell.trim()) {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      endRow(i);
      if (ch === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    } else cell += ch;
    i++;
  }
  if (rows.length < max && (cell || cells.length)) endRow(text.length);
  return rows;
}

/** The delimiter most lines agree on, or null when the text isn't a table. */
export function sniffDelimiter(text: string): SourceTable["delimiter"] | null {
  const lines = text.split("\n", 12).filter((l) => l.trim());
  if (lines.length < 3) return null;
  let best: { d: SourceTable["delimiter"]; n: number } | null = null;
  for (const d of ["\t", ",", ";"] as const) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const n = counts[0];
    if (n < 1) continue;
    // Most lines split the same way as the header (quoted cells can hide a few delimiters).
    const agree = counts.filter((c) => c >= n).length;
    if (agree >= Math.ceil(lines.length * 0.7) && (!best || n > best.n)) best = { d, n };
  }
  return best?.d ?? null;
}

/** Header names that say who wrote a row. */
const WHO = /^(customer|client|user|requester|reporter|author|contact|account|company|organi[sz]ation|email|e-mail|from|name|reviewer|respondent)(\s*(id|name|email|e-mail))?$|^(العميل|الاسم|البريد|المستخدم|اسم العميل)$/i;

export function whoColumn(columns: string[]): string | undefined {
  return columns.find((c) => WHO.test(c.trim()));
}

/** A text as a table: a header, two data rows or more, two columns or more. Null: not one. */
export function tableOf(text: string, delimiter: SourceTable["delimiter"] | null = sniffDelimiter(text)): SourceTable | null {
  if (!delimiter) return null;
  const rows = parseRows(text, delimiter);
  if (rows.length < 3) return null;
  const columns = rows[0].cells.map((c) => c.trim());
  if (columns.length < 2) return null;
  const who = whoColumn(columns);
  return { delimiter, columns, rows: rows.length - 1, ...(who ? { who } : {}) };
}

const memo = new WeakMap<object, { text: string; rows: Row[] }>();

/** A table source's data rows (memoized per record while its text stays the same). */
export function dataRows(s: { text: string; table?: SourceTable }): Row[] {
  if (!s.table) return [];
  const hit = memo.get(s);
  if (hit && hit.text === s.text) return hit.rows;
  const rows = parseRows(s.text, s.table.delimiter).slice(1);
  memo.set(s, { text: s.text, rows });
  return rows;
}

/** The data row an offset in the text falls in (-1: the header, or none). */
export function rowAt(rows: Row[], offset: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].end < offset) lo = mid + 1;
    else if (rows[mid].start > offset) hi = mid - 1;
    else return mid;
  }
  return -1;
}

/** Who wrote a row, by the table's who column ("" when it doesn't say). */
export function rowWho(s: { table?: SourceTable }, row: Row): string {
  const i = s.table?.who ? s.table.columns.indexOf(s.table.who) : -1;
  return i >= 0 ? (row.cells[i] ?? "").replace(/\s+/g, " ").trim() : "";
}
