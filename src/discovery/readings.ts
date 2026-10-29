import type { MetricReading, OstMetric } from "./types";
import { parseRows, sniffDelimiter } from "./table";

/*
 * An outcome's number over time (pure): readings typed in as it moves, or read by code from an
 * export (a CSV of dates and values from the analytics tool). Code finds the date column and the
 * number column, parses them, and says what it took, so the team can check it; the model never
 * reads or writes a number here.
 */

const DAY = 86_400_000;
export const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Readings by day, a later one for the same day replacing an earlier one, oldest first. */
export function mergeReadings(...lists: (MetricReading[] | undefined)[]): MetricReading[] {
  const byDay = new Map<string, MetricReading>();
  for (const list of lists) for (const r of list ?? []) if (Number.isFinite(r.value) && Number.isFinite(r.at)) byDay.set(dayKey(r.at), r);
  return [...byDay.values()].sort((a, b) => a.at - b.at);
}

/** The metric with a new reading of `value` at `at`: its readings, and its current number the latest. */
export function withReading(m: OstMetric, value: number, at: number, from?: string): OstMetric {
  const readings = mergeReadings(m.readings, [{ at, value, ...(from ? { from } : {}) }]);
  return { ...m, readings, current: readings[readings.length - 1].value, ...(m.baseline === null ? { baseline: readings[0].value } : {}) };
}

/** Readings merged in: the current number is the latest, the baseline the first when there was none. */
export function withReadings(m: OstMetric, add: MetricReading[]): OstMetric {
  const readings = mergeReadings(m.readings, add);
  if (!readings.length) return m;
  return { ...m, readings, current: readings[readings.length - 1].value, ...(m.baseline === null ? { baseline: readings[0].value } : {}) };
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const westernDigits = (s: string) => s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));

/** A number as an export writes it ("1,234.5", "12%", "٣٫٥", "$40"), or null. */
export function parseNumber(raw: string): number | null {
  let s = westernDigits(raw.trim()).replace(/[٫]/g, ".").replace(/[٬\s]/g, "");
  s = s.replace(/^[^\d.+-]+|[^\d.]+$/g, "");
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type DateOrder = "ymd" | "dmy" | "mdy";

function dateParts(raw: string): [number, number, number] | null {
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/.exec(westernDigits(raw.trim()));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** How a column writes its dates, from all of them (day first unless a value says otherwise). */
export function dateOrder(values: string[]): DateOrder | null {
  const parts = values.map(dateParts);
  if (!parts.length || parts.some((p) => !p)) {
    // Words ("Jan 3, 2026", "3 March 2026"): the platform reads those.
    return values.every((v) => Number.isFinite(Date.parse(v.trim()))) && values.length ? "ymd" : null;
  }
  const ps = parts as [number, number, number][];
  if (ps.every((p) => p[0] > 31)) return "ymd";
  if (ps.some((p) => p[0] > 12)) return "dmy";
  if (ps.some((p) => p[1] > 12)) return "mdy";
  return "dmy";
}

export function parseDate(raw: string, order: DateOrder): number | null {
  const p = dateParts(raw);
  if (!p) {
    const t = Date.parse(raw.trim());
    return Number.isFinite(t) ? t : null;
  }
  const [y, mo, d] = order === "ymd" ? p : order === "dmy" ? [p[2], p[1], p[0]] : [p[2], p[0], p[1]];
  const year = y < 100 ? 2000 + y : y;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(year, mo - 1, d, 12);
  return new Date(t).getUTCDate() === d ? t : null;
}

export interface ReadingsFound {
  readings: MetricReading[];
  dateColumn: string;
  valueColumn: string;
  order: DateOrder;
  /** Rows that had no date or no number in those columns. */
  skipped: number;
}

/**
 * Readings in an export: the first column whose cells are all dates, and the number column (the
 * one named like the metric, else the first that's numbers). Null: no such columns.
 */
export function readingsFromTable(text: string, o: { name?: string; from?: string } = {}): ReadingsFound | null {
  const d = sniffDelimiter(text);
  if (!d) return null;
  const rows = parseRows(text, d);
  if (rows.length < 2) return null;
  const header = rows[0].cells.map((c) => c.trim());
  const body = rows.slice(1);
  const col = (i: number) => body.map((r) => (r.cells[i] ?? "").trim()).filter(Boolean);
  // A date: day, month and year in numbers, or in words the platform reads (never a bare number, which reads as a year).
  const dateLike = (v: string) => !!dateParts(v) || (parseNumber(v) === null && Number.isFinite(Date.parse(v)));
  const dateIdx = header.findIndex((_, i) => {
    const v = col(i);
    const dates = v.filter(dateLike);
    return dates.length >= 1 && dates.length >= v.length * 0.7 && dateOrder(dates) !== null;
  });
  if (dateIdx < 0) return null;
  const numeric = header.map((_, i) => i).filter((i) => i !== dateIdx && col(i).length && col(i).filter((x) => parseNumber(x) !== null).length >= col(i).length * 0.7);
  if (!numeric.length) return null;
  const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const want = o.name ? words(o.name) : new Set<string>();
  const named = numeric.find((i) => [...words(header[i])].some((w) => want.has(w)));
  const valueIdx = named ?? numeric[0];
  const order = dateOrder(col(dateIdx).filter(dateLike))!;
  const readings: MetricReading[] = [];
  let skipped = 0;
  for (const r of body) {
    const at = parseDate(r.cells[dateIdx] ?? "", order);
    const value = parseNumber(r.cells[valueIdx] ?? "");
    if (at === null || value === null) skipped++;
    else readings.push({ at, value, ...(o.from ? { from: o.from } : {}) });
  }
  if (!readings.length) return null;
  return { readings: mergeReadings(readings), dateColumn: header[dateIdx] || `Column ${dateIdx + 1}`, valueColumn: header[valueIdx] || `Column ${valueIdx + 1}`, order, skipped };
}

/** How the number moved since a moment: the readings before and after it (null: not enough to say). */
export function movedSince(m: OstMetric, at: number): { before: number; after: number; change: number; better: boolean | null; days: number } | null {
  const rs = mergeReadings(m.readings);
  const before = [...rs].reverse().find((r) => r.at <= at);
  const after = rs[rs.length - 1];
  if (!before || !after || after.at <= at) return null;
  const change = after.value - before.value;
  return { before: before.value, after: after.value, change, better: change === 0 ? null : (change > 0) === (m.direction === "increase"), days: Math.round((after.at - at) / DAY) };
}
