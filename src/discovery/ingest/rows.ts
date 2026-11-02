/*
 * A spreadsheet of people's answers (a survey export, reviews, tickets) as who said what (pure):
 * each row one voice, named by its name column when it has one ("Sara: …"), else by its place
 * ("Respondent 4: …"), with its words from the columns that hold what people wrote. So the extract
 * reads each row as one person and a quote's speaker is in the text. Email and phone columns never
 * name anyone. A sheet with no column of people's words is read as plain text.
 */

/** Rows of a CSV or TSV, quotes and all ("a ""b"" c" is a "b" c; a quoted cell may span lines). */
export function parseDelimited(text: string, sep: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const WHO = /^(name|full ?name|customer|customer ?name|user|user ?name|author|reviewer|respondent|participant|from|submitted by)$/i;
const PRIVATE = /e-?mail|phone|mobile|tel\b|address|ip\b/i;
const SAID = /comment|feedback|review|answer|response|message|text|body|note|quote|why|what|describe|reason|suggest|improve|problem|issue|complain|like|dislike/i;
const SCORE = /rating|score|stars?|nps/i;
const DATE = /date|time|created|submitted|timestamp/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The rows as who said what, or null when no column holds what people wrote. */
export function rowsText(rows: string[][], max = 400): string | null {
  if (rows.length < 2) return null;
  const head = rows[0].map(clean);
  const body = rows.slice(1, max + 1);
  const width = head.length;
  const lengths = head.map((_, c) => mean(body.map((r) => clean(r[c] ?? "").length)));
  const who = head.findIndex((h) => WHO.test(h) && !PRIVATE.test(h));
  // People's words: a column named for them or asking them something, else a column of long text.
  const asks = (h: string) => SAID.test(h) || /\?\s*$/.test(h);
  let said = head.map((_, c) => c).filter((c) => c !== who && !PRIVATE.test(head[c]) && !DATE.test(head[c]) && (asks(head[c]) ? lengths[c] >= 8 : lengths[c] >= 30));
  if (!said.length) return null;
  said = said.slice(0, 4);
  const score = head.findIndex((h) => SCORE.test(h));
  const out: string[] = [];
  body.forEach((r, i) => {
    const words = said.map((c) => clean(r[c] ?? "")).filter(Boolean);
    if (!words.length) return;
    const name = who >= 0 ? clean(r[who] ?? "") : "";
    const rating = score >= 0 && clean(r[score] ?? "") ? ` (${head[score].toLowerCase()} ${clean(r[score])})` : "";
    const answer = said.length > 1 ? words.map((w, k) => `${head[said[k]]}: ${w}`).join(" · ") : words[0];
    out.push(`${name || `Respondent ${i + 1}`}${rating}: ${answer}`);
  });
  return out.length && width > 0 ? out.join("\n\n") : null;
}

const FIGURE = /^[\s(]*[-+]?[\d٠-٩][\d٠-٩.,\s]*(%|k|m|bn)?[\s)]*$/i;

/** Mostly numbers: figures to read as a table, whatever its columns are called. */
export function isFigures(rows: string[][]): boolean {
  const cells = rows.slice(1).flat().map(clean).filter(Boolean);
  return cells.length > 0 && cells.filter((c) => FIGURE.test(c)).length / cells.length >= 0.5;
}

/**
 * The rows as a table's: each row with its columns' names, so it means the same on its own, wherever
 * a long sheet is cut, and its words can be found. Null when there's no table to read.
 */
export function tableText(rows: string[][], max = 400): string | null {
  if (rows.length < 2) return null;
  const head = rows[0].map(clean);
  const lines = rows.slice(1, max + 1).flatMap((r) => {
    const cells = head.flatMap((h, c) => (clean(r[c] ?? "") && !PRIVATE.test(h) ? [h ? `${h}: ${clean(r[c])}` : clean(r[c])] : []));
    return cells.length ? [cells.join(" · ")] : [];
  });
  if (!lines.length) return null;
  const left = rows.length - 1 - max;
  return [...lines, ...(left > 0 ? [`(${left.toLocaleString("en-US")} more rows not read)`] : [])].join("\n");
}

/** A sheet as text: figures as a table, else who said what, else a table. */
export const sheetText = (rows: string[][]): string | null => (isFigures(rows) ? tableText(rows) : (rowsText(rows) ?? tableText(rows)));

/** An XLSX's first sheet as rows: its cells read from the sheet's own XML (shared strings and inline text). */
export function xlsxSheetRows(sheetXml: string, sharedXml: string | null): string[][] {
  const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))) : [];
  const col = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const row of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const inner = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const text = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")) : decode(v ?? "");
      const at = ref ? col(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = text;
    }
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
